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
  assert.equal(run('fmtFinish(Infinity)'), '—');
  assert.equal(run('fmtFinish(0)'), 'now');
  assert.equal(run('fmtFinish(32)'), run('fmtEta(32)').split(' · ')[1], 'the time of fmtEta, on its own');
});

test('ETAs say the day when it isn\'t today: the weekday in the next six days, the date after that, the year when it isn\'t this one', () => {
  const now = new Date(2026, 9, 24, 12, 0).getTime(); // a Saturday, midday
  ctx.Date = class extends Date {
    constructor(...a) {
      super(...(a.length ? a : [now]));
    }
    static now() {
      return now;
    }
  };
  try {
    const time = { hour: 'numeric', minute: '2-digit' };
    const at = (days, h, m) => new Date(2026, 9, 24 + days, h, m);
    const eta = (d) => run(`fmtEta(${(d - now) / MIN})`).split(' · ')[1];
    assert.equal(eta(at(0, 14, 36)), at(0, 14, 36).toLocaleTimeString([], time), 'today: the time only');
    assert.equal(eta(at(3, 2, 36)), at(3, 2, 36).toLocaleString([], { weekday: 'short', ...time }), 'in 3 days: the weekday and time');
    assert.equal(eta(at(6, 23, 0)), at(6, 23, 0).toLocaleString([], { weekday: 'short', ...time }), 'in 6 days: still the weekday');
    const date = { weekday: 'short', day: 'numeric', month: 'short' };
    assert.equal(eta(at(7, 2, 36)), at(7, 2, 36).toLocaleDateString([], date), 'a week away: the date, not today\'s weekday');
    assert.equal(eta(at(20, 9, 0)), at(20, 9, 0).toLocaleDateString([], date), 'further away: the date');
    assert.equal(run(`fmtWhen(${new Date(2027, 0, 5, 9, 0).getTime()})`), new Date(2027, 0, 5, 9, 0).toLocaleDateString([], { ...date, year: 'numeric' }), 'next year: with the year');
    assert.equal(run(`fmtWhen(${at(-1, 9, 0).getTime()})`), at(-1, 9, 0).toLocaleDateString([], date), 'yesterday: the date');
    ctx.Date = class extends ctx.Date {
      constructor(...a) {
        super(...(a.length ? a : [at(0, 23, 30)]));
      }
    };
    assert.equal(run(`fmtWhen(${at(1, 0, 42).getTime()})`), at(1, 0, 42).toLocaleString([], { weekday: 'short', ...time }), '11:30 PM to 12:42 AM is tomorrow, though under a day away');
  } finally {
    ctx.Date = Date;
  }
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

test('heartbeatStrip with nothing playing: checks as rings, the newest pulsing, and what it will show until the first', () => {
  const now = Date.now();
  ctx.tl = [];
  const empty = run(`heartbeatStrip(tl, ${now}, { idle: 'Each check <shows> here' })`);
  assert.match(empty, /hb-glow/);
  assert.match(empty, /Each check &lt;shows&gt; here/, 'escaped');

  ctx.tl = [
    { t: now - 20 * MIN, type: 'check', ok: true },
    { t: now - 10 * MIN, type: 'check', ok: false },
    { t: now - 3000, type: 'check', ok: true },
  ];
  const strip = run(`heartbeatStrip(tl, ${now}, { idle: 'Each check shows here' })`);
  assert.equal((strip.match(/class="hb-check/g) || []).length, 3);
  assert.equal((strip.match(/hb-check bad/g) || []).length, 1, 'a failed check is marked');
  assert.match(strip, new RegExp(`data-key="hb-ping-${now - 3000}"`), 'the new check pulses, keyed so a redraw leaves it alone');
  assert.match(strip, /hb-glow/);
  assert.doesNotMatch(strip, /hb-idle/, 'the checks say it themselves');

  // An old check doesn't pulse; nor is there a message over events in the lanes.
  ctx.tl = [{ t: now - 5 * MIN, type: 'check', ok: true }, { t: now - 30 * MIN, type: 'credit', delta: 2 }];
  const busy = run(`heartbeatStrip(tl, ${now}, { idle: 'quiet' })`);
  assert.doesNotMatch(busy, /hb-ping/);
  assert.doesNotMatch(busy, /hb-idle/);
  ctx.tl = [{ t: now - 30 * MIN, type: 'credit', delta: 2 }];
  assert.doesNotMatch(run(`heartbeatStrip(tl, ${now}, { idle: 'quiet' })`), /hb-idle/);
  assert.doesNotMatch(run(`heartbeatStrip(tl, ${now})`), /hb-glow|hb-idle/, 'not while something plays');
});

test('idleScene is a full circle in the middle of the card, whatever its shape', () => {
  const geo = (w, h) => {
    const svg = run(`idleScene({ mode: 'scan', items: [], width: ${w}, height: ${h} })`);
    const [, cx, cy, r] = svg.match(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)" class="is-ring edge"/).map(Number);
    return { cx, cy, r };
  };
  assert.deepEqual(geo(900, 300), { cx: 450, cy: 150, r: 132 }, 'a wide card: as tall as fits');
  assert.deepEqual(geo(400, 600), { cx: 200, cy: 300, r: 170 }, 'a tall one: as wide as fits');
  assert.equal(geo(100, 80).r, 50, 'never smaller than 50');
});

test('idleScene: a radar over the categories still to go, each lit as the beam passes', () => {
  const now = Date.now();
  ctx.items = [
    { name: 'Neon <Rush>', image: 'pd-img://neon.png' },
    { name: 'Cozy Hours', image: 'pd-img://cozy.png' },
    { name: 'Market Hours' },
  ];
  const svg = run(`idleScene({ mode: 'scan', items, width: 700, height: 300, checkedAt: ${now - 2000}, now: ${now} })`);
  assert.ok(!/NaN|Infinity|undefined/.test(svg));
  assert.match(svg, /idle-scene is-scan/);
  assert.match(svg, /class="is-beam"/);
  assert.equal((svg.match(/class="is-blip"/g) || []).length, 3);
  assert.match(svg, /Neon &lt;Rush&gt;/, 'names from Kick are escaped');
  assert.equal((svg.match(/<image /g) || []).length, 2, 'a category without art is just its disc');
  // Spread evenly round the circle, at -30°, 90° and 210°, each lit as the 8 s turn passes it.
  const delays = [...svg.matchAll(/class="is-name" style="animation-delay:([\d.]+)s"/g)].map((m) => Number(m[1]));
  assert.deepEqual(delays, [7.33, 2, 4.67]);
  assert.match(svg, new RegExp(`data-key="is-ripple-${now - 2000}"`), 'a new check ripples');

  assert.doesNotMatch(run(`idleScene({ mode: 'scan', items, checkedAt: ${now - 60_000}, now: ${now} })`), /is-ripple/, 'an old one doesn\'t');
  assert.match(run(`idleScene({ mode: 'scan', tone: 'warn', items })`), /is-warn/, 'amber while Kick isn\'t answering');
  ctx.many = Array.from({ length: 20 }, (_, i) => ({ name: `Cat ${i}` }));
  assert.equal((run(`idleScene({ mode: 'scan', items: many })`).match(/class="is-blip"/g) || []).length, 8, 'at most 8 fit');
});

test('idleScene paused: the categories still, with no beam; done: the rewards collected in an arc', () => {
  const paused = run(`idleScene({ mode: 'paused', items, width: 600, height: 260 })`);
  assert.match(paused, /is-paused/);
  assert.doesNotMatch(paused, /is-beam/);
  assert.match(paused, />Paused</);

  ctx.won = Array.from({ length: 14 }, (_, i) => ({ name: `Reward ${i}`, image: i % 2 ? `pd-img://r${i}.png` : null }));
  const done = run(`idleScene({ mode: 'done', items: won, width: 600, height: 260 })`);
  assert.ok(!/NaN|Infinity|undefined/.test(done));
  assert.match(done, /is-done/);
  assert.equal((done.match(/class="is-reward"/g) || []).length, 12, 'at most 12 in the arc');
  assert.match(done, /is-trophy/);
  assert.match(done, /<title>Reward 1<\/title>/, 'each one says what it is');
  assert.doesNotMatch(done, /is-beam|is-blip/);
});

test('progressChart for a stream that just started: a dashed line across the past, and the label clear of the line', () => {
  const now = Date.now();
  ctx.fresh = { points: [[now - MIN, 536], [now, 538]], rewards: [{ name: 'Cx Emote', required: 600, tracked: true }], target: 600, now, rate: 1, width: 800, height: 400 };
  const svg = run('progressChart(fresh)');
  assert.ok(!/NaN|Infinity/.test(svg));
  assert.match(svg, /class="series earlier"/, 'what it was at most, before the first reading');
  assert.match(svg, /class="earlier-area"/);
  assert.match(svg, />538 of 600 min</);
  assert.doesNotMatch(svg, /min now/);
  const now_ = svg.match(/<circle cx="[\d.]+" cy="([\d.]+)" r="5" class="now-dot"/);
  const label = svg.match(/<g class="pill p-now">\s*<rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="22"/);
  assert.ok(Number(label[1]) + 22 < Number(now_[1]) - 4, 'the label sits above the dot');

  // History back to the chart's edge needs no dashed line.
  ctx.long = { ...ctx.fresh, points: [[now - 3 * 3600_000, 400], [now, 538]] };
  assert.doesNotMatch(run('progressChart(long)'), /earlier/);
  // Near the top of the chart, the label goes under the dot instead.
  ctx.top = { ...ctx.fresh, points: [[now - 3 * 3600_000, 0], [now, 600]] };
  const top = run('progressChart(top)');
  const dot = Number(top.match(/<circle cx="[\d.]+" cy="([\d.]+)" r="5" class="now-dot"/)[1]);
  const below = Number(top.match(/<g class="pill p-now">\s*<rect x="[\d.]+" y="([\d.]+)"/)[1]);
  assert.ok(below > dot, 'below the dot');
});

test('progressChart: the past starts at the first reading, keeping at least 10 minutes', () => {
  const now = Date.now();
  const left = (points) => {
    ctx.span = { points, rewards: [{ name: 'Cx Emote', required: 600, tracked: true }], target: 600, now, rate: 1, width: 900, height: 400 };
    return { svg: run('progressChart(span)') };
  };
  // Readings from 20 minutes ago: no shading or dashes reach further back than them.
  const recent = left([[now - 20 * MIN, 538], [now - 10 * MIN, 546], [now, 554]]);
  assert.doesNotMatch(recent.svg, /class="series earlier"/, 'the readings start at the edge');
  const xNow = Number(recent.svg.match(/<line x1="([\d.]+)" x2="[\d.]+" y1="[\d.]+" y2="[\d.]+" class="now-line"/)[1]);
  assert.ok(xNow > 42 + 0.2 * (900 - 60), `the climb has room (now at x=${xNow})`);
  // A stream that just started: still 10 minutes of past, with the dashed line before its reading.
  assert.match(left([[now - MIN, 553], [now, 554]]).svg, /class="series earlier"/);
});

test('progressChart for a paused campaign: what resuming would bring, in times from resuming', () => {
  const now = Date.now();
  ctx.paused = {
    points: [[now - 30 * MIN, 40], [now, 48]],
    rewards: [
      { name: 'Ethan Emote', required: 60, tracked: true },
      { name: 'Done Badge', required: 180, tracked: true },
    ],
    target: 180,
    now,
    rate: 1,
    resume: true,
    width: 700,
    height: 300,
  };
  const svg = run('progressChart(paused)');
  assert.match(svg, /progress-chart resume/);
  assert.match(svg, /IF YOU RESUME/);
  assert.doesNotMatch(svg, /FORECAST/);
  assert.match(svg, /Ethan Emote · 12m in/);
  assert.match(svg, /Done 2h 12m after resuming/);
  // Further out than the chart reaches.
  ctx.slow = { ...ctx.paused, points: [[now, 6]], target: 600, rewards: [{ name: 'Safe Badge', required: 600, tracked: true }], rate: 0.021 };
  assert.match(run('progressChart(slow)'), /Done \d+d after resuming/);
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
