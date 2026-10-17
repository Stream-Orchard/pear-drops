const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { History, GROUP_OF } = require('../../../src/main/history');

const MIN = 60_000;

function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-hist-'));
  return { dir, history: new History(dir) };
}

function session(h, { start, minutes, slug = 'pixelpear', campaignId = 'c1', credits = minutes / 2, reason = 'Stream went offline', stall = false }) {
  const s = `s-${start}`;
  const stream = { session: s, slug, channel: slug, campaignIds: [campaignId] };
  h.add('watch-start', { t: start, ...stream, campaigns: ['Neon'] });
  for (let i = 1; i <= credits; i++) h.add('credit', { t: start + i * 2 * MIN, ...stream, campaignId, campaign: 'Neon', category: 'Neon Rush', delta: 2, units: i * 2 });
  if (stall) h.add('stall', { t: start + MIN, ...stream });
  h.add('watch-end', { t: start + minutes * MIN, ...stream, reason });
}

test('every event type belongs to a filter group', () => {
  for (const type of ['credit', 'claim', 'unlock', 'watch-start', 'stall', 'reload', 'crash', 'offline', 'conflict', 'pause', 'login']) assert.ok(GROUP_OF[type], type);
});

test('sessions pair starts and ends, with credits, stalls and efficiency', () => {
  const { history } = fresh();
  const t = Date.now() - 5 * 3600_000;
  session(history, { start: t, minutes: 60, credits: 15, stall: true });
  const [s] = history.sessions(history.events);
  assert.equal(s.slug, 'pixelpear');
  assert.equal(s.credited, 30);
  assert.equal(s.stalls, 1);
  assert.equal(s.ms, 60 * MIN);
  assert.equal(s.efficiency, 0.5);
  assert.equal(s.reason, 'Stream went offline');
});

test('an unfinished session counts up to now and is marked open', () => {
  const { history } = fresh();
  const now = Date.now();
  history.add('watch-start', { t: now - 10 * MIN, session: 'x', slug: 'a', campaignIds: ['c1'] });
  const [s] = history.sessions(history.events, now);
  assert.ok(s.open);
  assert.equal(s.ms, 10 * MIN);
});

test('view(): totals, per-drop summaries, channels, daily and hourly figures', () => {
  const { history } = fresh();
  const now = Date.now();
  session(history, { start: now - 26 * 3600_000, minutes: 40, slug: 'a' });
  session(history, { start: now - 3 * 3600_000, minutes: 20, slug: 'b' });
  history.add('claim', { t: now - 2 * 3600_000, campaignId: 'c1', campaign: 'Neon', reward: 'Hype Emote' });
  history.add('conflict', { t: now - 3600_000 });
  history.add('credit-elsewhere', { t: now - 3600_000, campaignId: 'c2', delta: 2 });

  const v = history.view({ now });
  assert.equal(v.totals.watchMs, 60 * MIN);
  assert.equal(v.totals.credited, 60);
  assert.equal(v.totals.efficiency, 1);
  assert.equal(v.totals.claims, 1);
  assert.equal(v.totals.conflicts, 1);
  assert.equal(v.totals.elsewhere, 2);
  assert.equal(v.totals.channels, 2);
  const neon = v.campaigns.find((c) => c.campaignId === 'c1');
  assert.equal(neon.credited, 60);
  assert.equal(neon.claims, 1);
  assert.equal(neon.watchMs, 60 * MIN);
  assert.equal(v.channels[0].slug, 'a');
  assert.equal(v.daily.reduce((s, d) => s + d.credited, 0), 60);
  assert.equal(v.daily.reduce((s, d) => s + d.watched, 0), 60);
  assert.equal(v.hourly.reduce((s, m) => s + m, 0), 60);
});

test('view(): range, drop focus, groups and text search filter the timeline', () => {
  const { history } = fresh();
  const now = Date.now();
  session(history, { start: now - 3 * 86_400_000, minutes: 10, campaignId: 'old' });
  session(history, { start: now - 3600_000, minutes: 10, campaignId: 'c1', slug: 'nightowl' });
  history.add('pause', { t: now - 1000, text: 'Paused' });

  const recent = history.view({ since: now - 86_400_000, now });
  assert.ok(recent.events.every((e) => e.t >= now - 86_400_000));
  assert.ok(!recent.campaigns.some((c) => c.campaignId === 'old'));

  const focused = history.view({ campaignId: 'c1', now });
  assert.ok(focused.events.every((e) => e.campaignId === 'c1' || e.campaignIds?.includes('c1')));
  assert.equal(focused.series.length, 5);

  const app = history.view({ groups: ['app'], now });
  assert.deepEqual(app.events.map((e) => e.type), ['pause']);

  const search = history.view({ text: 'nightowl', now });
  assert.ok(search.events.length > 0 && search.events.every((e) => e.channel === 'nightowl' || e.text?.includes('nightowl')));
});

test('events are saved to disk and loaded back in order', async () => {
  const { dir, history } = fresh();
  history.add('start', { t: Date.now() - 1000, text: 'b' });
  history.add('pause', { t: Date.now() - 2000, text: 'a' });
  await history.writing;
  const again = new History(dir).load();
  assert.deepEqual(again.events.map((e) => e.text), ['a', 'b']);
});

test('lines that are not JSON are skipped when loading', () => {
  const { dir } = fresh();
  fs.writeFileSync(path.join(dir, 'history.jsonl'), `{"t":${Date.now()},"type":"start"}\nnot json\n`);
  assert.equal(new History(dir).load().events.length, 1);
});
