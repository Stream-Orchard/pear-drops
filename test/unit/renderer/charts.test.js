// The renderer's helpers are plain browser scripts: load them into a sandbox.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DIR = path.join(__dirname, '..', '..', '..', 'src', 'renderer');
const noop = () => {};
const ctx = vm.createContext({ document: { querySelector: () => null, addEventListener: noop, documentElement: { addEventListener: noop, dataset: {} } }, window: { addEventListener: noop }, navigator: { platform: 'MacIntel' }, Date, Math, Number, String, Array, JSON, Intl });
for (const file of ['icons.js', 'charts.js', 'format.js']) vm.runInContext(fs.readFileSync(path.join(DIR, file), 'utf8'), ctx, { filename: file });
const run = (code) => vm.runInContext(code, ctx);
const MIN = 60_000;

test('escapeHtml escapes markup from Kick data', () => {
  assert.equal(run(`escapeHtml('<img src=x onerror="a">&\\'')`), '&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;');
});

test('durations, counts and ETAs read naturally', () => {
  assert.equal(run('fmtDur(45_000)'), '45s');
  assert.equal(run('fmtDur(12 * 60_000)'), '12m');
  assert.equal(run('fmtDur(94 * 60_000)'), '1h 34m');
  assert.equal(run('fmtDur(50 * 3600_000)'), '2d 2h');
  assert.equal(run('fmtCount(2380)'), '2.4K');
  assert.equal(run('fmtCount(42_000)'), '42K');
  assert.equal(run('fmtEta(Infinity)'), '—');
  assert.equal(run('fmtEta(0)'), 'now');
  assert.match(run('fmtEta(32)'), /^32m · /);
});

test('progressChart draws history, a forecast with reward markers, and stays finite', () => {
  ctx.args = {
    points: [
      [Date.now() - 60 * MIN, 100],
      [Date.now() - 30 * MIN, 130],
      [Date.now(), 148],
    ],
    rewards: [
      { name: 'Hype Rocket', required: 60, tracked: true, claimed: true },
      { name: 'Turbo Grin', required: 180, tracked: true, image: 'data:image/png;base64,AA' },
      { name: 'Neon Crown', required: 300, tracked: true },
      { name: 'Skin', required: 240, tracked: false },
    ],
    target: 300,
    now: Date.now(),
    rate: 1,
    width: 700,
    height: 260,
  };
  const svg = run('progressChart(args)');
  assert.match(svg, /^<svg class="chart progress-chart"/);
  assert.match(svg, /FORECAST/);
  assert.match(svg, /Turbo Grin · /);
  assert.match(svg, /Done /);
  assert.ok(!/NaN|Infinity/.test(svg));
  assert.ok(!svg.includes('Skin'), 'game drops are not marked');
});

test('progressChart in history mode has no forecast, and copes with one point', () => {
  ctx.one = { points: [[Date.now(), 5]], rewards: [], target: 60, now: Date.now(), rate: 0, forecast: false, width: 300, height: 150 };
  const svg = run('progressChart(one)');
  assert.ok(!svg.includes('FORECAST'));
  assert.ok(!/NaN|Infinity/.test(svg));
});

test('heartbeatStrip and sparkBars draw events and bars', () => {
  ctx.tl = [
    { t: Date.now() - 5 * MIN, type: 'sent' },
    { t: Date.now() - 4 * MIN, type: 'credit', delta: 2 },
    { t: Date.now() - 3 * MIN, type: 'switch' },
    { t: Date.now() - 2 * MIN, type: 'claim' },
    { t: Date.now() - 3 * 3600_000, type: 'credit', delta: 2 },
  ];
  const strip = run('heartbeatStrip(tl, Date.now())');
  assert.equal((strip.match(/hb-credit/g) || []).length, 1, 'events older than the window are left out');
  assert.match(strip, /hb-sent/);
  assert.match(strip, /hb-claim/);
  assert.equal((run('sparkBars([0, 2, 4])').match(/<rect/g) || []).length, 3);
  assert.equal(run('sparkBars([])'), '');
});

test('progressRing clamps its fraction', () => {
  assert.match(run(`progressRing(2, { label: 'x' })`), /stroke-dashoffset="0"/);
});

test('the brand mark draws with plain fills, so every copy shows', () => {
  // It appears several times per page (titlebar, welcome screen, tray). Ids repeat
  // across copies, and a gradient defined inside a hidden copy paints nowhere.
  const svg = run('brandMark(28)');
  assert.match(svg, /width="28"/);
  assert.doesNotMatch(svg, /\sid=|url\(#/);
});

test('the font: the system one on macOS and Windows, the bundled Inter on Linux, or whatever was chosen', () => {
  const font = (platform, choice) => run(`navigator.platform = ${JSON.stringify(platform)}; applyFont(${JSON.stringify(choice)}); document.documentElement.dataset.font`);
  assert.equal(font('MacIntel'), 'system', 'set as the page loads, before any settings arrive');
  assert.equal(font('Win32'), 'system');
  assert.equal(font('Linux x86_64'), 'bundled');
  assert.equal(font('Linux x86_64', 'system'), 'system');
  assert.equal(font('MacIntel', 'bundled'), 'bundled');
  assert.equal(font('MacIntel', 'comic-sans'), 'system', 'an unknown choice falls back to the default');
});

test('progressChart: a forecast many hours out reaches the target, with the past wide enough for its labels', () => {
  const now = Date.now();
  // 6 of 600 minutes, done in about 20 h (the 12 h cap once stopped the line short of it).
  ctx.far = { points: [[now - 10 * MIN, 0], [now, 6]], rewards: [{ name: 'Safe Badge', required: 600, tracked: true }], target: 600, now, rate: 0.5, width: 900, height: 300 };
  const svg = run('progressChart(far)');
  assert.ok(!/NaN|Infinity/.test(svg));
  assert.match(svg, /Done .* · 19h 4[0-9]m|Done .* · 1[89]h|Done .* · 20h/, 'the finish is marked, not off the edge');
  const proj = svg.match(/class="projection"/) && svg.match(/<path d="M([\d.]+),([\d.]+) L([\d.]+),([\d.]+)" class="projection"/);
  const yTarget = svg.match(/<line x1="[\d.]+" x2="[\d.]+" y1="([\d.]+)" y2="[\d.]+" class="guide"/)?.[1];
  assert.ok(proj, 'a projection is drawn');
  assert.ok(Math.abs(Number(proj[4]) - Number(yTarget)) < 1, 'the projection ends on the target line');
  const xNow = Number(svg.match(/<line x1="([\d.]+)" x2="[\d.]+" y1="[\d.]+" y2="[\d.]+" class="now-line"/)[1]);
  assert.ok(xNow - 42 > 120, `the past keeps room for its labels (now at x=${xNow})`);
  assert.match(svg, /CREDITED/);

  // Further out than two weeks: the edge says when instead.
  ctx.farther = { ...ctx.far, rate: 0.021 };
  assert.match(run('progressChart(farther)'), /Done in \d+d/);
});

test('the stream health chip: what is wrong with the stream, in a word, with its colour', () => {
  const f = (state, text, extra = {}) => ({ current: { slug: 'arcadia', username: 'Arcadia' }, health: { state, text }, player: { video: { height: 720 } }, ...extra });
  assert.equal(run('streamHealth(null)'), null);
  ctx.f = { current: null, health: null };
  assert.equal(run('streamHealth(f)'), null, 'nothing watched');
  const look = (state, text) => {
    ctx.f = f(state, text);
    return run('streamHealth(f)');
  };
  assert.deepEqual({ ...look('playing', 'Playing') }, { state: 'playing', label: 'Playing', tone: 'good', foot: '720p · window muted' });
  assert.equal(look('frozen', "The picture hasn't moved for 20s").tone, 'bad');
  assert.equal(look('frozen', "The picture hasn't moved for 20s").foot, "The picture hasn't moved for 20s");
  assert.equal(look('checking', 'The video ended, checking with Kick…').label, 'Checking');
  assert.equal(look('buffering', '').tone, 'warn');
  assert.equal(look('paused', '').tone, 'bad');
  assert.equal(look('loading', '').label, 'Loading');
  assert.equal(look('mystery', 'x').label, 'Loading', 'an unknown state reads as loading');
});

test('the stream notice says what happened and where the app went next', () => {
  const at = Date.now();
  ctx.f = { notice: { kind: 'raid', text: 'Arcadia raided pixelpete', slug: 'arcadia', at }, current: { slug: 'emberfox', username: 'EmberFox' } };
  assert.equal(run('streamNotice(f)').text, 'Arcadia raided pixelpete, now watching EmberFox');
  assert.equal(run('streamNotice(f)').icon, 'skip');
  ctx.f = { notice: { kind: 'ended', text: 'Arcadia ended the stream', slug: 'arcadia', at }, current: null, paused: false };
  assert.equal(run('streamNotice(f)').text, 'Arcadia ended the stream, looking for another stream');
  ctx.f = { notice: { kind: 'reload', text: 'Reloaded Arcadia', slug: 'arcadia', at }, current: { slug: 'arcadia', username: 'Arcadia' } };
  assert.equal(run('streamNotice(f)').text, 'Reloaded Arcadia', 'same stream: nothing to add');
  assert.equal(run('streamNotice(f)').icon, 'reload');
  ctx.f = { notice: null };
  assert.equal(run('streamNotice(f)'), null);
});

test('Settings › Updates: a spinner while checking, an arrow dropping in while downloading (not a spinning arrow)', () => {
  vm.runInContext(fs.readFileSync(path.join(DIR, 'updates.js'), 'utf8'), ctx, { filename: 'updates.js' });
  ctx.u = (state) => ({ state, repo: 'pearfarmer/pear-drops', current: '0.1.1', latest: '0.2.0', progress: 0.4 });
  const badge = (state) => run(`badgeIcon(updMessage(u(${JSON.stringify(state)})))`);
  assert.match(badge('checking'), /class="spinner xs"/);
  assert.match(badge('downloading'), /class="dl-arrow"/);
  assert.ok(!/spinner/.test(badge('downloading')));
  assert.ok(!/dl-arrow|spinner/.test(badge('available')), 'other states keep their icon');
  run(`upd.status = u('downloading')`);
  assert.match(run('updateChip()'), /class="dl-arrow".*40%/s, 'the title bar chip too');
});

test('images: a missing one, or one that failed to load, shows a placeholder in its own box, and is tried again later', () => {
  assert.match(run("img('https://x/a.png', 'avatar', 'EmberFox')"), /^<img class="avatar" src="https:\/\/x\/a\.png" alt="EmberFox"/);
  assert.equal(run("img(null, 'avatar', 'EmberFox')"), '<span class="avatar img-missing" role="img" aria-label="EmberFox"></span>');
  assert.equal(run('img(null)'), '<span class="img-missing fill" role="img" aria-label=""></span>', 'no class: it fills its box');
  run("brokenImages.set('https://x/gone.png', Date.now())");
  assert.match(run("img('https://x/gone.png', 'thumb-art')"), /img-missing/, 'a failed one stays a placeholder');
  run("brokenImages.set('https://x/gone.png', Date.now() - 6 * 60_000)");
  assert.match(run("img('https://x/gone.png', 'thumb-art')"), /^<img /, 'tried again after a few minutes');
});
