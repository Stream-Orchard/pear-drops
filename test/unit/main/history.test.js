const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { History, GROUP_OF } = require('../../../src/main/history');
const { Db, openDb } = require('../../../src/main/db');

const MIN = 60_000;

function fresh() {
  return { history: new History(new Db(':memory:')).load() };
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
  for (const type of ['credit', 'claim', 'unlock', 'watch-start', 'stall', 'reload', 'crash', 'offline', 'conflict', 'pause', 'login', 'link-connected', 'link-disconnected', 'link-unpaired']) assert.ok(GROUP_OF[type], type);
});

test('sessions pair starts and ends, with credits, stalls and efficiency', () => {
  const { history } = fresh();
  const t = Date.now() - 5 * 3600_000;
  session(history, { start: t, minutes: 60, credits: 15, stall: true });
  const [s] = history.sessions(history.all());
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
  const [s] = history.sessions(history.all(), now);
  assert.ok(s.open);
  assert.equal(s.ms, 10 * MIN);
});

test('a session left without an end (the app quit by force or restarted) stops at the next one or the next launch, a few minutes after it was last heard from', () => {
  const { history } = fresh();
  const now = Date.now();
  const t0 = now - 10 * 3600_000;
  const credit = (t, session) => history.add('credit', { t, session, slug: session, campaignId: 'c1', delta: 2, units: 2 });
  // App started, watched "a" for 30 min with credits, then the app was killed.
  history.add('start', { t: t0 });
  history.add('watch-start', { t: t0 + MIN, session: 'a', slug: 'a', campaignIds: ['c1'] });
  for (let m = 3; m <= 31; m += 2) credit(t0 + m * MIN, 'a');
  // Started again two hours later, watched "b" and was killed again; "c" starts straight after it without an end.
  history.add('start', { t: t0 + 2 * 3600_000 });
  history.add('watch-start', { t: t0 + 2 * 3600_000 + MIN, session: 'b', slug: 'b', campaignIds: ['c1'] });
  credit(t0 + 2 * 3600_000 + 3 * MIN, 'b');
  history.add('watch-start', { t: t0 + 2 * 3600_000 + 4 * MIN, session: 'c', slug: 'c', campaignIds: ['c1'] });
  // The stream being watched now, still going.
  history.add('start', { t: now - 20 * MIN });
  history.add('watch-start', { t: now - 19 * MIN, session: 'd', slug: 'd', campaignIds: ['c1'] });

  const s = Object.fromEntries(history.sessions(history.all(), now).map((x) => [x.session, x]));
  assert.equal(s.a.ms, 35 * MIN, "a: to 5 min after its last credit, not to the next launch two hours later");
  assert.equal(s.a.reason, 'App closed');
  assert.ok(s.a.cut);
  assert.equal(s.b.ms, 3 * MIN, 'b: up to when c started');
  assert.equal(s.c.ms, 5 * MIN, 'c: nothing heard from it, so 5 min at most');
  assert.ok(s.d.open, 'd is the one still going');
  assert.equal(s.d.ms, 19 * MIN);

  // Nothing overlaps, so no day can hold more than it has.
  const v = history.view({ now });
  assert.equal(v.totals.watchMs, (35 + 3 + 5 + 19) * MIN);
  assert.ok(v.daily.every((d) => d.watched <= 1440));
  assert.equal(v.hourly.reduce((a, b) => a + b, 0), 35 + 3 + 5 + 19);
});

test('the activity chart is by hour on a first day or the last 24 hours, and by day once there is more', () => {
  const { history } = fresh();
  const now = new Date();
  now.setMinutes(30, 0, 0);
  const t = now.getTime();
  const start = t - 5 * 3600_000; // 5 h ago, at :30
  history.add('start', { t: start - MIN });
  history.add('watch-start', { t: start, session: 'a', slug: 'a', campaignIds: ['c1'], title: 'Ranked grind, road to the top' });
  for (let m = 2; m <= 300; m += 2) history.add('credit', { t: start + m * MIN - 1000, session: 'a', slug: 'a', campaignId: 'c1', delta: 2, units: m });
  history.add('claim', { t: start + 90 * MIN, session: 'a', campaignId: 'c1', reward: 'Hype Emote' });
  history.add('claim', { t: start + 95 * MIN, session: 'a', campaignId: 'c1', reward: 'Neon Badge' });

  const v = history.view({ now: t });
  assert.equal(v.sessions[0].title, 'Ranked grind, road to the top', 'sessions keep the stream title');
  assert.equal(v.activity.unit, 'hour', 'a first day is shown by hour');
  assert.equal(v.activity.bars.length, 6, 'from the hour it started to now');
  assert.equal(v.activity.bars[0].watched, 30, 'the first half hour');
  assert.ok(v.activity.bars.slice(1, -1).every((b) => b.watched === 60), 'full hours in between');
  assert.ok(v.activity.bars.every((b) => b.watched <= 60));
  assert.equal(v.activity.bars.reduce((n, b) => n + b.credited, 0), 300);
  assert.equal(v.activity.bars.reduce((n, b) => n + b.claims, 0), 2);

  // Weeks of history: by day, unless the last 24 hours are picked.
  history.addMany([{ t: t - 20 * 86_400_000, type: 'start' }]); // recorded later, with an earlier time
  assert.equal(history.view({ now: t }).activity.unit, 'day');
  const day = history.view({ now: t, since: t - 86_400_000 });
  assert.equal(day.activity.unit, 'hour');
  assert.equal(day.activity.bars.length, 25, 'the last 24 hours, by the hour');
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

test('events are saved in the database and read back in time order', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-hist-'));
  const db = openDb(dir);
  const history = new History(db).load();
  history.add('start', { t: Date.now() - 1000, text: 'b' });
  history.add('pause', { t: Date.now() - 2000, text: 'a' });
  db.close();
  const again = new History(openDb(dir)).load();
  assert.deepEqual(again.all().map((e) => e.text), ['a', 'b']);
  assert.equal(again.seq, 2, 'new ids carry on from the saved ones');
  again.db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('events over a year old are forgotten when loading', () => {
  const db = new Db(':memory:');
  const now = Date.now();
  db.addEvents([
    { t: now - 401 * 86_400_000, type: 'start', text: 'old' },
    { t: now - 1000, type: 'start', text: 'new' },
  ]);
  assert.deepEqual(new History(db).load(now).all().map((e) => e.text), ['new']);
});

test('a write that fails (the database closed as the app quit) is ignored', () => {
  const { history } = fresh();
  history.db.close();
  assert.doesNotThrow(() => history.add('pause', { text: 'd' }));
  assert.doesNotThrow(() => history.addMany([{ t: Date.now(), type: 'pause' }]));
  assert.deepEqual(history.all(), []);
  assert.equal(history.count('claim'), 0);
  assert.equal(history.firstAt(), null);
  assert.equal(history.lastSession(), null);
  assert.equal(history.view().totals.sessions, 0);
});

test('count(), isEmpty() and lastSession() read the database directly', () => {
  const { history } = fresh();
  assert.ok(history.isEmpty());
  const now = Date.now();
  session(history, { start: now - 5 * 3600_000, minutes: 30, slug: 'a' });
  history.add('claim', { t: now - 4 * 3600_000 });
  history.add('claim', { t: now - 1000 });
  history.add('watch-start', { t: now - 10 * MIN, session: 'open', slug: 'b', campaignIds: ['c1'] });
  history.add('credit', { t: now - 8 * MIN, session: 'open', slug: 'b', campaignId: 'c1', delta: 2 });
  assert.ok(!history.isEmpty());
  assert.equal(history.count('claim'), 2);
  assert.equal(history.count('claim', now - 3600_000), 1);
  const last = history.lastSession(now);
  assert.equal(last.slug, 'b');
  assert.ok(last.open);
  assert.equal(last.credited, 2);
});

test('the History view reads its range once, then only what was recorded since', () => {
  const { history } = fresh();
  const now = Date.now();
  session(history, { start: now - 3600_000, minutes: 10 });
  assert.equal(history.view({ now }).totals.credited, 10);
  const read = [];
  const events = history.db.events.bind(history.db);
  history.db.events = (opts) => (read.push(opts), events(opts));
  history.add('credit', { t: now - 1000, campaignId: 'c1', delta: 2 });
  assert.equal(history.view({ now }).totals.credited, 12, 'the new credit counts');
  assert.ok(read[0].after > 0, 'only rows after the ones already read');
  assert.equal(history.view({ now, since: now - 30 * MIN }).totals.credited, 2, 'another range is read afresh');
  assert.equal(read.at(-1).after, 0);
});
