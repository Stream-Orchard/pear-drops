const test = require('node:test');
const assert = require('node:assert/strict');
const { ActivityLog, MINUTES } = require('../../../src/main/activity');

const MV = 'com.glowingpear.streammultiview';
const OTHER = 'com.streamorchard.other';
const T = Date.UTC(2026, 9, 18, 16, 0, 0);

const msg = (at, m) => ({ at, app: MV, bytes: 100, ...m });

test('messages are kept newest first, a page at a time, with the totals each way', () => {
  const log = new ActivityLog({ now: () => T });
  for (let i = 0; i < 12; i++) log.add(msg(T - (12 - i) * 1000, { dir: i % 3 ? 'out' : 'in', kind: 'event', method: 'drops.farming.changed', data: { i } }));
  const first = log.page(MV, { limit: 5, now: T });
  assert.deepEqual(first.entries.map((e) => e.data.i), [11, 10, 9, 8, 7]);
  assert.equal(first.total, 12);
  assert.equal(first.newer, 0);
  assert.deepEqual([first.totals.sent, first.totals.received, first.totals.bytesOut, first.totals.bytesIn], [8, 4, 800, 400]);
  const next = log.page(MV, { limit: 5, before: first.entries.at(-1).n, now: T });
  assert.deepEqual(next.entries.map((e) => e.data.i), [6, 5, 4, 3, 2]);
  assert.equal(next.newer, 5, 'how many are on newer pages');
  assert.deepEqual(log.page(MV, { filter: 'in', now: T }).entries.map((e) => e.data.i), [9, 6, 3, 0]);
  assert.equal(log.page(MV, { filter: 'out', limit: 50, now: T }).total, 8);
  assert.equal(log.page(MV, { filter: 'nonsense', now: T }).total, 12, 'an unknown filter shows everything');
});

test('only the last few hundred are kept', () => {
  const log = new ActivityLog({ max: 5, now: () => T });
  for (let i = 0; i < 9; i++) log.add(msg(T, { dir: 'out', kind: 'event', method: 'drops.farming.changed', data: { i } }));
  assert.deepEqual(log.page(MV, { limit: 50 }).entries.map((e) => e.data.i), [8, 7, 6, 5, 4]);
  assert.equal(log.page(MV).totals.sent, 9, 'the totals count every one');
});

test('the heartbeat is counted and its round trip kept, not logged', () => {
  const log = new ActivityLog({ now: () => T });
  assert.equal(log.add(msg(T, { dir: 'out', kind: 'request', method: 'link.ping', id: 4 })), null);
  assert.equal(log.add(msg(T + 3, { dir: 'in', kind: 'reply', method: 'link.ping', id: 4, ms: 3 })), null);
  let p = log.page(MV);
  assert.equal(p.total, 0);
  assert.deepEqual(p.totals.ping, { at: T + 3, ms: 3 });
  assert.equal(p.totals.pings, 1);
  // The listening side hears pings: when, with the last round trip it knew.
  log.add(msg(T + 20_000, { dir: 'in', kind: 'request', method: 'link.ping', id: 9 }));
  p = log.page(MV);
  assert.deepEqual(p.totals.ping, { at: T + 20_000, ms: 3 });
  // A ping that failed is a problem worth seeing.
  assert.ok(log.add(msg(T + 40_000, { dir: 'in', kind: 'error', method: 'link.ping', id: 9, data: { code: -32004, message: 'Too many messages' } })));
  assert.equal(log.page(MV).problems, 1);
  log.ended(MV);
  assert.equal(log.page(MV).totals.ping, null, 'a new connection, a new heartbeat');
  log.ended('com.streamorchard.never-linked');
});

test('notes: connected, a test, a dropped message, shown in their app’s log (or every app’s)', () => {
  const log = new ActivityLog({ now: () => T });
  log.note(MV, { tone: 'ok', text: 'Connected to Stream Multiview' });
  log.note(null, { kind: 'note', tone: 'warn', text: 'Dropped an invalid players.changed' });
  log.note(OTHER, { text: 'Connected to Other' });
  log.add({ at: T, app: null, dir: 'in', kind: 'request', method: 'link.hello', id: 1, bytes: 300 });
  const p = log.page(MV, { limit: 10 });
  assert.deepEqual(p.entries.map((e) => e.text ?? e.method), ['link.hello', 'Dropped an invalid players.changed', 'Connected to Stream Multiview']);
  assert.equal(p.entries[2].at, T);
  assert.equal(p.problems, 1);
  assert.deepEqual(log.page(MV, { filter: 'problems' }).entries.map((e) => e.tone), ['warn']);
  assert.equal(log.page(OTHER).total, 3);
  assert.equal(p.totals.sent + p.totals.received, 0, 'a hello from an app not yet known counts for none');
  const wait = log.note(MV, { about: 'players', text: 'Farming stopped · Kick players sign back in after a few minutes' });
  assert.equal(wait.about, 'players', 'what it’s about, for its icon');
  assert.equal(wait.kind, 'status');
  assert.equal(log.page(MV).problems, 1, 'not a problem');
  assert.equal('about' in p.entries[0], false, 'only when given');
});

test('the chart: messages a minute each way over the last half hour, with problems', () => {
  const log = new ActivityLog({ now: () => T });
  log.add(msg(T - 5 * 60_000, { dir: 'out', kind: 'event', method: 'drops.farming.changed' }));
  log.add(msg(T - 5 * 60_000 + 1000, { dir: 'out', kind: 'event', method: 'drops.farming.changed' }));
  log.add(msg(T - 60_000, { dir: 'in', kind: 'error', method: 'players.get', data: { code: -32601, message: 'No' } }));
  log.add(msg(T - 3 * 3_600_000, { dir: 'in', kind: 'event', method: 'players.changed' })); // long gone from the chart
  const chart = log.page(MV, { now: T + 1000 }).minutes;
  assert.equal(chart.length, MINUTES);
  assert.deepEqual(chart.at(-6), { out: 2, in: 0, bad: 0 });
  assert.deepEqual(chart.at(-2), { out: 0, in: 1, bad: 1 });
  assert.equal(chart.reduce((n, m) => n + m.out + m.in, 0), 3);
  assert.deepEqual(log.page(OTHER).minutes.at(-1), { out: 0, in: 0, bad: 0 });
});
