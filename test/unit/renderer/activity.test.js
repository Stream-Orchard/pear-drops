// The Activity view's words and chart (src/renderer/activity.js), in a sandbox like the other renderer scripts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DIR = path.join(__dirname, '..', '..', '..', 'src', 'renderer');
const noop = () => {};
const ctx = vm.createContext({
  document: { querySelector: () => null, addEventListener: noop, documentElement: { addEventListener: noop, dataset: {} } },
  window: { addEventListener: noop, pd: { connected: { onActivity: noop } } },
  navigator: { platform: 'MacIntel' },
  Date,
  Math,
  Number,
  String,
  Array,
  JSON,
  Intl,
  Object,
  Map,
});
for (const file of ['icons.js', 'charts.js', 'format.js', 'activity.js']) vm.runInContext(fs.readFileSync(path.join(DIR, file), 'utf8'), ctx, { filename: file });
const run = (code, vars = {}) => {
  Object.assign(ctx, vars);
  return vm.runInContext(code, ctx);
};
const say = (e) => run('describeActivity(e, "Stream Multiview")', { e });

test('each message in plain words, either way', () => {
  const farming = { state: 'farming', channel: { platform: 'kick', slug: 'pixelpear', name: 'PixelPear' }, drop: { campaign: 'Neon Rush Launch Week', progress: { done: 48.6, total: 120 } } };
  assert.deepEqual({ ...say({ dir: 'out', kind: 'event', method: 'drops.farming.changed', data: farming }) }, { title: 'drops.farming.changed', kind: 'event', text: 'Farming Neon Rush Launch Week on PixelPear · 48 of 120 min' });
  assert.equal(say({ dir: 'out', kind: 'event', method: 'drops.farming.changed', data: { state: 'paused' } }).text, 'Paused');
  assert.equal(say({ dir: 'out', kind: 'event', method: 'drops.farming.changed', data: { state: 'signed-out' } }).text, 'Signed out of Kick');
  assert.equal(say({ dir: 'out', kind: 'reply', method: 'drops.farming.get', data: { state: 'waiting' } }).text, 'Waiting for a stream with drops');
  assert.equal(say({ dir: 'in', kind: 'request', method: 'drops.farming.get', data: {} }).text, 'Stream Multiview asked what’s being farmed');
  assert.equal(say({ dir: 'in', kind: 'request', method: 'drops.farming.show', data: {} }).text, 'Stream Multiview asked to show Pear Drops');
  assert.equal(say({ dir: 'out', kind: 'reply', method: 'drops.farming.show', data: { shown: true } }).text, 'Shown');
  const players = { platforms: { kick: { signedIn: false, mode: 'auto', account: null, open: [{ slug: 'pixelpear' }, { slug: 'moonlitmaple' }] } } };
  assert.equal(say({ dir: 'in', kind: 'event', method: 'players.changed', data: players }).text, '2 Kick players open, signed out while Pear Drops farms');
  // The state and why in one phrase: Auto signed in isn't "signed in · signed out while you farm".
  const kick = (k) => say({ dir: 'in', kind: 'event', method: 'players.changed', data: { platforms: { kick: { account: null, open: [{ slug: 'pixelpear' }], ...k } } } }).text;
  assert.equal(kick({ signedIn: true, mode: 'auto' }), '1 Kick player open, signed in (Auto)');
  assert.equal(kick({ signedIn: true, mode: 'signed-in' }), '1 Kick player open, signed in (always)');
  assert.equal(kick({ signedIn: false, mode: 'signed-out' }), '1 Kick player open, signed out (always)');
  assert.equal(kick({ signedIn: true, mode: 'by-channel' }), '1 Kick player open, signed in · by-channel', 'a mode it has no words for');
  assert.equal(kick({ signedIn: false }), '1 Kick player open, signed out');
  assert.equal(say({ dir: 'in', kind: 'event', method: 'players.changed', data: { platforms: {} } }).text, 'No Kick players open');
  assert.equal(say({ dir: 'out', kind: 'request', method: 'players.get', data: {} }).text, 'Asked Stream Multiview about its players');
  assert.equal(say({ dir: 'out', kind: 'request', method: 'link.hello' }).text, 'Hello, with what Pear Drops speaks');
  assert.equal(say({ dir: 'in', kind: 'reply', method: 'link.hello' }).text, 'Stream Multiview said hello back');
  assert.equal(say({ dir: 'out', kind: 'request', method: 'link.subscribe', data: { events: ['players.changed'] } }).text, 'Asked Stream Multiview for players.changed');
  assert.equal(say({ dir: 'in', kind: 'reply', method: 'link.subscribe', data: { subscribed: [] } }).text, 'Stream Multiview will send nothing');
  assert.equal(say({ dir: 'in', kind: 'event', method: 'link.bye', data: { reason: 'quitting' } }).text, 'Goodbye: quitting');
  assert.equal(say({ dir: 'in', kind: 'error', method: 'players.get', data: { code: -32601, message: 'No such method' } }).text, 'No such method (-32601)');
  assert.equal(say({ dir: 'in', kind: 'event', method: 'clips.changed', data: { seq: 1, at: '', clips: [] } }).text, 'clips', 'one it has no words for: its fields');
  assert.deepEqual({ ...say({ kind: 'status', tone: 'ok', text: 'Connected to Stream Multiview' }) }, { title: 'Link', kind: 'status', text: 'Connected to Stream Multiview' });
});

test('the wait to sign Kick players back in is a marker with a clock; the heartbeat’s numbers sit in boxes', () => {
  const at = new Date(2026, 9, 18, 17, 0, 0).getTime();
  const entries = [
    { n: 2, at: at + 50, app: 'mv', dir: null, kind: 'status', method: null, tone: '', about: 'players', text: 'Farming stopped · Kick players sign back in after a few minutes' },
    { n: 1, at, app: 'mv', dir: null, kind: 'status', method: null, tone: 'ok', text: 'Connected to Stream Multiview' },
  ];
  const data = (ping) => ({ entries, total: 2, newer: 0, problems: 0, latest: 2, started: at, minutes: Array.from({ length: 30 }, () => ({ out: 0, in: 0, bad: 0 })), totals: { sent: 1, received: 1, bytesOut: 10, bytesIn: 10, ping } });
  const pane = (ping) => {
    run('act.app = "mv"; act.data = d; act.seen = Infinity', { d: data(ping), $: () => null, ui: {}, state: null });
    return run('activityPane({ name: "Stream Multiview", status: "connected" })');
  };
  const html = pane({ at: Date.now() - 8000, ms: 3 });
  const [wait, link] = html.match(/<span class="act-pill">[^]*?<\/span><\/span>/g);
  assert.match(wait, /Farming stopped · Kick players sign back in after a few minutes/);
  assert.match(wait, new RegExp(run('icon("clock")').replace(/[()[\]{}.*+?^$|\\]/g, '\\$&')), 'a clock');
  assert.match(link, new RegExp(run('icon("link")').replace(/[()[\]{}.*+?^$|\\]/g, '\\$&')), 'the link');
  assert.match(html, /<b><span class="act-num">3<\/span> ms<\/b><em><span class="act-num">8<\/span>s ago<\/em>/, 'the round trip and the seconds, two digits wide');
  assert.match(pane({ at: Date.now() - 125_000, ms: 0.4 }), /<b>&lt;1 ms<\/b><em><span class="act-num">2<\/span>m ago<\/em>/);
  assert.match(pane(null), /<b>—<\/b><\/span>/, 'none yet');
  run('act.app = null; act.data = null');
});

test('an open message lists its fields by path, arrays by their length', () => {
  const r = run('activityFields(d, 4)', { d: { state: 'farming', channel: { slug: 'pixelpear', name: null }, drop: { rewards: { items: [1, 2] } }, extra: 1 } });
  assert.deepEqual(JSON.parse(JSON.stringify(r)), { fields: [['state', 'farming'], ['channel.slug', 'pixelpear'], ['channel.name', 'null'], ['drop.rewards.items', '2 items']], more: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(run('activityFields({})'))), { fields: [['(empty)', '{}']], more: 0 });
});

test('the chart has a bar a minute, sent under received, and a mark for a problem', () => {
  const minutes = Array.from({ length: 30 }, (_, i) => ({ out: i === 29 ? 3 : 0, in: i === 29 ? 1 : 0, bad: i === 10 ? 1 : 0 }));
  const svg = run('trafficChart(m, 600)', { m: minutes });
  assert.equal((svg.match(/class="act-bar-bg"/g) ?? []).length, 30);
  assert.equal((svg.match(/class="act-bar-out"/g) ?? []).length, 1);
  assert.equal((svg.match(/class="act-bar-in"/g) ?? []).length, 1);
  assert.equal((svg.match(/class="act-bar-bad"/g) ?? []).length, 1);
  assert.match(svg, /3 sent, 1 received/);
  assert.match(svg, /1 problem"/);
});

test('activity.js declares nothing another page script already has (one would quietly replace the other)', () => {
  const names = (file) => new Set([...fs.readFileSync(path.join(DIR, file), 'utf8').matchAll(/^(?:async\s+)?(?:function\s+|(?:const|let|var)\s+)([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]));
  const mine = names('activity.js');
  for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.js') && f !== 'activity.js' && !f.startsWith('tray'))) {
    const clash = [...names(file)].filter((n) => mine.has(n));
    assert.deepEqual(clash, [], `${file} also declares ${clash.join(', ')}`);
  }
});
