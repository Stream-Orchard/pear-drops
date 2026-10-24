const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { TrayController, ringPixels, logoPixels, chestPixels, dailyPixels, withDailyReward, pathOutlines, HOP_FRAMES, HOP_MS, WIDTH } = require('../../../src/main/tray');

/** A popover window that, like Windows with display scaling, reports itself a little bigger than it was set. */
function fakeWindow({ inflate = 3 } = {}) {
  const win = {
    bounds: { x: 0, y: 0, width: WIDTH, height: 520 },
    visible: false,
    calls: 0,
    isDestroyed: () => false,
    isVisible: () => win.visible,
    getSize: () => [win.bounds.width + inflate, win.bounds.height + inflate],
    setSize(width, height) {
      win.calls++;
      Object.assign(win.bounds, { width, height });
    },
    setBounds(b) {
      win.calls++;
      win.bounds = { ...b };
    },
  };
  return win;
}

/** A taskbar along the bottom of a 1920×1080 screen, with the tray icon near its right end. */
function setup(opts) {
  const handlers = {};
  const tray = new TrayController({
    onShowMain() {},
    onQuit() {},
    onAction() {},
    ipc: { handle: (name, fn) => (handlers[name] = fn) },
    screen: { getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }) },
  });
  const win = fakeWindow(opts);
  tray.popover = win;
  tray.tray = { getBounds: () => ({ x: 1800, y: 1044, width: 24, height: 32 }) };
  const resize = (height) => handlers['tray:resize'](null, height);
  return { tray, win, resize };
}

test('the open popover keeps its width however often its page reports its height (it once grew on Windows)', () => {
  const { win, resize } = setup();
  win.visible = true;
  for (let i = 0; i < 50; i++) resize(331.4);
  assert.equal(win.bounds.width, WIDTH);
  assert.equal(win.bounds.height, 331);
  assert.equal(win.calls, 1, 'the same height again leaves the window alone');
});

test('the popover follows its content height, within limits, and stays inside the work area above the taskbar', () => {
  const { win, resize } = setup();
  win.visible = true;
  resize(400);
  assert.deepEqual(win.bounds, { x: 1920 - WIDTH - 8, y: 1040 - 400 - 4, width: WIDTH, height: 400 });
  resize(5000);
  assert.equal(win.bounds.height, 720);
  resize(10);
  assert.equal(win.bounds.height, 200);
  resize(NaN);
  assert.equal(win.bounds.height, 200, 'not a height');
});

test('a hidden popover is resized in place and placed when it opens', () => {
  const { tray, win, resize } = setup();
  resize(300);
  assert.deepEqual(win.bounds, { x: 0, y: 0, width: WIDTH, height: 300 });
  tray.position();
  assert.deepEqual(win.bounds, { x: 1920 - WIDTH - 8, y: 1040 - 300 - 4, width: WIDTH, height: 300 });
});

/** The colour and cover at a point (0-1 across the icon). */
const at = ({ buf, px }, x, y) => {
  const i = (Math.floor(y * px) * px + Math.floor(x * px)) * 4;
  return { r: buf[i + 2], g: buf[i + 1], b: buf[i], a: buf[i + 3] };
};
/** How many of the icon's pixels have any cover. */
const covered = ({ buf }) => buf.filter((_, i) => i % 4 === 3 && buf[i] > 0).length;
/** The highest row with any cover (0-1 down the icon). */
const top = ({ buf, px }) => Math.floor(buf.findIndex((v, i) => i % 4 === 3 && v > 0) / 4 / px) / px;

test('paths are read the way SVG reads them: moves, lines, curves and arcs, absolute or relative', () => {
  const [square] = pathOutlines('M1 1h2v2H1z');
  assert.deepEqual(square, { points: [[1, 1], [3, 1], [3, 3], [1, 3]], closed: true });
  const [moved] = pathOutlines('m2 2 3 0 0 3');
  assert.deepEqual(moved.points, [[2, 2], [5, 2], [5, 5]], 'pairs after a move are lines');
  const [curve] = pathOutlines('M0 0C0 10 10 10 10 0');
  assert.deepEqual(curve.points.at(-1), [10, 0]);
  assert.ok(Math.abs(curve.points[8][1] - 7.5) < 1e-9, 'halfway along, the curve is at 3/4 of its handles');
  const [arc] = pathOutlines('M0 0a5 5 0 0 1 10 0');
  for (const [x, y] of arc.points) assert.ok(Math.abs(Math.hypot(x - 5, y) - 5) < 1e-9, 'every point is on the circle');
  assert.ok(arc.points.some(([, y]) => y < -4.9), 'swept through the top');
  const [tiny] = pathOutlines('M0 0A1 1 0 0 0 10 0');
  for (const [x, y] of tiny.points) assert.ok(Math.abs(Math.hypot(x - 5, y) - 5) < 1e-9, 'too small a radius grows to reach');
  assert.throws(() => pathOutlines('M0 0Q1 1 2 2'), /Unsupported/);
});

test('the logo is the drop and its pear on nothing: green round the pear, dark in it, clear at the corners', () => {
  const logo = logoPixels();
  assert.equal(logo.px, 36);
  assert.equal(at(logo, 0.02, 0.02).a, 0, 'no tile behind it');
  assert.equal(at(logo, 0.97, 0.97).a, 0);
  const drop = at(logo, 0.5, 0.3);
  assert.deepEqual([drop.r, drop.g, drop.b, drop.a], [83, 252, 24, 255]);
  const pear = at(logo, 0.5, 0.75);
  assert.ok(pear.a === 255 && pear.g < 40, 'the pear is dark');
  assert.ok(covered(logo) < 36 * 36 * 0.6, 'a drop, not a square');
});

test('as templates, the logo is a black drop with the pear cut out, and the ring is black on a faint track', () => {
  const logo = logoPixels({ template: true });
  const drop = at(logo, 0.5, 0.3);
  assert.deepEqual([drop.r, drop.g, drop.b, drop.a], [0, 0, 0, 255]);
  assert.equal(at(logo, 0.5, 0.75).a, 0, 'the pear is a hole');
  assert.equal(at(logo, 0.02, 0.02).a, 0);
  const ring = ringPixels(0.5, 'waiting', { template: true });
  const done = at(ring, 0.5, 0.14);
  const left = at(ring, 0.14, 0.5);
  assert.deepEqual([done.r, done.g, done.b, done.a], [0, 0, 0, 255]);
  assert.deepEqual([left.r, left.g, left.b], [0, 0, 0]);
  assert.ok(left.a > 0 && left.a < 160, 'the rest of the ring is faint');
});

test('the logo and chest are the pages’ own shapes', () => {
  const page = (f) => fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'renderer', f), 'utf8');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'main', 'tray.js'), 'utf8');
  const paths = (file, fn) => [...page(file).match(new RegExp(`function ${fn}[\\s\\S]*?\\n}`))[0].matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(paths('icons.js', 'brandMark').length, 5);
  assert.equal(paths('daily-reward.js', 'chestMark').length, 3);
  for (const d of [...paths('icons.js', 'brandMark'), ...paths('daily-reward.js', 'chestMark')]) assert.ok(src.includes(d), d);
});

test('the chest hops: it crouches, leaps, lands, and throws its pixels only as it lands', () => {
  const frame = (t) => chestPixels(t);
  const rest = frame(0);
  const crouch = frame(0.16);
  const leap = frame(0.516);
  const landed = frame(0.82);
  assert.ok(covered(rest) > 300, 'a chest');
  assert.ok(top(crouch) > top(rest), 'squashed lower');
  assert.ok(top(leap) < top(rest) - 0.05, 'in the air');
  assert.ok(top(leap) > 0, 'still inside the icon');
  const pixel = (p) => p.buf.some((v, i) => i % 4 === 0 && v > 150 && p.buf[i + 2] < 100); // teal: much blue, little red
  assert.ok(!pixel(rest) && !pixel(leap));
  assert.ok(pixel(landed), 'the burst');
  const edge = at(rest, 0.5, 0.26); // the lid's top edge
  assert.deepEqual([edge.r, edge.g, edge.b], [83, 252, 24], 'drawn in green');
  assert.deepEqual(chestPixels(1).buf, rest.buf, 'the loop ends where it starts');
});

/** A controller with a fake tray that keeps the images it's given. */
test('the daily reward’s hour is the chest, still, in a ring filled clockwise from the top', () => {
  const half = dailyPixels(0.5);
  assert.equal(half.px, 36);
  assert.equal(at(half, 0.02, 0.02).a, 0, 'clear at the corners');
  const green = (p) => p.a === 255 && p.g > 240 && p.r < 100;
  assert.ok(green(at(half, 0.5, 0.09)), 'filled from the top');
  assert.ok(green(at(half, 0.91, 0.5)), 'round the right');
  const left = at(half, 0.09, 0.5);
  assert.ok(left.a > 0 && left.a < 160 && left.g < 200, 'the rest is the faint track');
  assert.ok(green(at(half, 0.41, 0.5)), 'the chest’s side, in the middle');
  assert.equal(at(half, 0.5, 0.25).a, 0, 'a gap between the chest and its ring');
  const none = dailyPixels(0);
  assert.ok(at(none, 0.5, 0.09).a < 160, 'nothing watched: all track');
  assert.ok(green(at(none, 0.41, 0.5)), 'and the chest');
  assert.deepEqual(dailyPixels(-1).buf, none.buf);
  assert.ok(green(at(dailyPixels(1), 0.09, 0.5)), 'the whole ring at the hour');
});

test('the daily reward on the icon: the chest when ready, its ring while the hour fills with no stream playing, else the drop’s ring', () => {
  const waiting = { tone: 'waiting', fraction: 0, title: '', tooltip: 'Pear Drops · No live streams', mark: 'logo' };
  const earning = { state: 'earning', minutes: 37, threshold: 60 };
  assert.deepEqual(withDailyReward(waiting, earning), { ...waiting, mark: 'daily', fraction: 37 / 60, title: '61%', tooltip: 'Pear Drops · No live streams · Daily reward 37 of 60 min' });
  const done = { tone: 'done', fraction: 0, title: '', tooltip: 'Pear Drops · Every emote and badge drop is claimed' };
  assert.equal(withDailyReward(done, earning).mark, 'daily', 'every drop done');
  assert.equal(withDailyReward(waiting, { state: 'earning', minutes: 0, threshold: 0 }).fraction, 0);
  const farming = info();
  for (const other of [farming, info({ tone: 'paused', fraction: 0 }), info({ tone: 'error' })]) assert.equal(withDailyReward(other, earning), other, other.tone);
  const ready = withDailyReward(farming, { state: 'ready', minutes: 60, threshold: 60 });
  assert.equal(ready.mark, 'chest');
  assert.equal(ready.tooltip, 'Pear Drops · Daily reward ready to claim');
  assert.equal(withDailyReward(farming, { state: 'ready', crate: 'Trick or Treat' }).tooltip, 'Pear Drops · Trick or Treat ready to claim', 'an event’s crate, by its name');
  assert.equal(withDailyReward(waiting, { state: 'ready' }).mark, 'chest', 'over the logo too');
  for (const daily of [{ state: 'claimed', minutes: 60, threshold: 60 }, null, undefined]) assert.equal(withDailyReward(waiting, daily), waiting);
});

function iconSetup({ motion = true, mac = false } = {}) {
  const shown = [];
  const tray = new TrayController({
    onShowMain() {},
    onQuit() {},
    onAction() {},
    ipc: { handle() {} },
    image: (pixels, template = false) => ({ ...pixels, template }),
    motion: () => motion,
    mac,
  });
  tray.tray = { setImage: (img) => shown.push(img), setTitle() {}, setToolTip() {}, destroy() {} };
  return { tray, shown };
}
const info = (more) => ({ tone: 'farming', fraction: 0.5, title: '50%', tooltip: 'Pear Drops', ...more });

test('the icon is the ring, the logo with no stream live, and draws each only when it changes', () => {
  const { tray, shown } = iconSetup();
  tray.update(info());
  tray.update(info({ title: '50%' }));
  assert.equal(shown.length, 1);
  assert.deepEqual(shown[0].buf, ringPixels(0.5, 'farming').buf);
  tray.update(info({ tone: 'waiting', fraction: 0, mark: 'logo' }));
  tray.update(info({ tone: 'waiting', fraction: 0, mark: 'logo' }));
  assert.equal(shown.length, 2);
  assert.deepEqual(shown[1].buf, logoPixels().buf);
  tray.update(info({ fraction: 0.6 }));
  tray.update(info({ mark: 'logo' }));
  assert.equal(shown[3], shown[1], 'the logo is drawn once');
});

test('the chest hops on the icon while the daily reward waits, and stops once it’s claimed', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { tray, shown } = iconSetup();
  tray.update(info({ mark: 'chest' }));
  assert.deepEqual(shown[0].buf, chestPixels(0).buf);
  t.mock.timers.tick(HOP_MS);
  assert.equal(shown.length, HOP_FRAMES + 1, 'a whole hop each loop');
  assert.equal(shown.at(-1), shown[0], 'back to the start');
  tray.update(info({ mark: 'chest', title: '51%' }));
  t.mock.timers.tick(HOP_MS / HOP_FRAMES);
  assert.equal(shown.length, HOP_FRAMES + 2, 'one hop at a time');
  tray.update(info());
  const after = shown.length;
  t.mock.timers.tick(HOP_MS * 2);
  assert.equal(shown.length, after, 'claimed: no more frames');
  assert.deepEqual(shown.at(-1).buf, ringPixels(0.5, 'farming').buf);
  tray.update(info({ mark: 'chest' }));
  assert.equal(shown.at(-1), shown[0], 'its frames are kept');
  tray.destroy();
  t.mock.timers.tick(HOP_MS);
  assert.equal(tray.hop, null);
});

test('on macOS the icon is a template unless it’s farming, in trouble, or the reward waits; elsewhere always in colour', () => {
  const { tray, shown } = iconSetup({ mac: true });
  const last = () => shown.at(-1);
  tray.update(info());
  assert.equal(last().template, false);
  assert.deepEqual(last().buf, ringPixels(0.5, 'farming').buf, 'farming stays green');
  for (const tone of ['conflict', 'error']) {
    tray.update(info({ tone }));
    assert.equal(last().template, false, tone);
  }
  for (const tone of ['waiting', 'paused', 'done', 'idle']) {
    tray.update(info({ tone }));
    assert.equal(last().template, true, tone);
    assert.deepEqual(last().buf, ringPixels(0.5, tone, { template: true }).buf);
  }
  tray.update(info({ mark: 'logo' }));
  assert.equal(last().template, true);
  assert.deepEqual(last().buf, logoPixels({ template: true }).buf);
  tray.update(info({ mark: 'chest' }));
  assert.equal(last().template, false, 'the chest stays green');
  tray.destroy();

  const other = iconSetup();
  for (const more of [{ tone: 'waiting' }, { tone: 'idle' }, { mark: 'logo' }]) {
    other.tray.update(info(more));
    assert.equal(other.shown.at(-1).template, false, JSON.stringify(more));
  }
  assert.deepEqual(other.shown.at(-1).buf, logoPixels().buf);
});

test('the daily ring is drawn as its percent changes, in colour on macOS too', () => {
  const { tray, shown } = iconSetup({ mac: true });
  tray.update(info({ tone: 'waiting', mark: 'daily', fraction: 0.5 }));
  tray.update(info({ tone: 'waiting', mark: 'daily', fraction: 0.501 }));
  assert.equal(shown.length, 1);
  assert.equal(shown[0].template, false, 'its hour filling is something to say');
  assert.deepEqual(shown[0].buf, dailyPixels(0.5).buf);
  tray.update(info({ tone: 'waiting', mark: 'daily', fraction: 0.52 }));
  assert.equal(shown.length, 2);
  assert.deepEqual(shown[1].buf, dailyPixels(0.52).buf);
  tray.update(info({ tone: 'waiting', mark: 'logo' }));
  assert.deepEqual(shown[2].buf, logoPixels({ template: true }).buf, 'claimed elsewhere: the logo again');
});

test('with reduced motion the chest sits still', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { tray, shown } = iconSetup({ motion: false });
  tray.update(info({ mark: 'chest' }));
  t.mock.timers.tick(HOP_MS * 3);
  assert.equal(shown.length, 1);
  assert.deepEqual(shown[0].buf, chestPixels(0).buf);
});
