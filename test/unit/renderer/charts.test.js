// The renderer's helpers are plain browser scripts: load them into a sandbox.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DIR = path.join(__dirname, '..', '..', '..', 'src', 'renderer');
const noop = () => {};
const ctx = vm.createContext({ document: { querySelector: () => null, addEventListener: noop, documentElement: { addEventListener: noop } }, window: { addEventListener: noop }, Date, Math, Number, String, Array, JSON, Intl });
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
