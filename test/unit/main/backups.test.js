const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Db, openDb, listBackups, backupName, BACKUPS } = require('../../../src/main/db');
const { Backups } = require('../../../src/main/backups');

const DAY = 86_400_000;
const T = Date.UTC(2026, 9, 18, 9, 0, 0);

function setup(settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-backups-'));
  const db = openDb(dir);
  const events = [];
  const logged = [];
  const s = { backupEvery: 'day', backupKeep: 3, ...settings };
  const backups = new Backups({ db, dir, settings: () => s, history: { add: (type, data) => events.push({ type, ...data }) }, log: (text) => logged.push(text) });
  const done = () => {
    backups.stop();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { dir, db, s, backups, events, logged, done };
}

test('the first backup is due at once, the next a day (or a week) later, and none when off', async () => {
  const { s, backups, done } = setup();
  assert.equal(backups.due(T), true);
  await backups.check(T);
  assert.equal(backups.status().last.at, T);
  assert.equal(backups.due(T + 12 * 3_600_000), false);
  assert.equal(backups.due(T + DAY - 30 * 60_000), true, 'a little early still counts, so it doesn’t drift later each day');
  s.backupEvery = 'week';
  assert.equal(backups.due(T + 2 * DAY), false);
  assert.equal(backups.due(T + 7 * DAY), true);
  s.backupEvery = 'off';
  assert.equal(backups.due(T + 30 * DAY), false);
  s.backupEvery = 'hourly'; // not one of the choices
  assert.equal(backups.every, 'day');
  done();
});

test('a backup holds the data, and only the newest are kept', async () => {
  const { dir, db, s, backups, done } = setup();
  db.set('k', 'saved');
  const changes = [];
  backups.on('change', () => changes.push(backups.status().running));
  const file = await backups.run(T);
  assert.deepEqual(changes, [true, false], 'running, then done');
  const copy = new Db(file);
  assert.equal(copy.get('k'), 'saved');
  copy.close();
  for (let i = 1; i <= 4; i++) await backups.run(T + i * DAY);
  fs.writeFileSync(path.join(dir, BACKUPS, backupName(T - 3 * DAY, 2)), 'x');
  fs.writeFileSync(path.join(dir, BACKUPS, backupName(T - 2 * DAY, 3)), 'x');
  fs.writeFileSync(path.join(dir, BACKUPS, backupName(T - DAY, 4)), 'x');
  backups.rotate();
  const kept = listBackups(path.join(dir, BACKUPS));
  assert.deepEqual(kept.filter((b) => !b.before).map((b) => b.at), [T + 4 * DAY, T + 3 * DAY, T + 2 * DAY]);
  assert.deepEqual(kept.filter((b) => b.before).map((b) => b.before), [4, 3], 'the last two made before an update');
  s.backupKeep = 7;
  assert.equal(backups.keep, 7);
  s.backupKeep = 5; // not one of the choices
  assert.equal(backups.keep, 3);
  const status = backups.status();
  assert.equal(status.count, 5);
  assert.equal(status.last.at, T + 4 * DAY);
  assert.equal(status.size, kept.reduce((sum, b) => sum + b.size, 0));
  assert.equal(status.error, null);
  done();
});

test('one backup at a time', async () => {
  const { backups, done } = setup();
  const a = backups.run(T);
  assert.equal(backups.run(T + 1000), a);
  await a;
  assert.equal(backups.status().count, 1);
  done();
});

test('a backup that fails is shown and recorded in History, and the next one clears it', async () => {
  const { dir, backups, events, logged, done } = setup();
  fs.writeFileSync(path.join(dir, BACKUPS), 'a file where the folder should be');
  assert.equal(await backups.run(T), null);
  assert.match(backups.status().error, /EEXIST|ENOTDIR/);
  assert.equal(events[0].type, 'backup-failed');
  assert.match(events[0].text, /Couldn’t back up/);
  assert.match(logged[0], /couldn't be backed up/);
  fs.rmSync(path.join(dir, BACKUPS));
  assert.ok(await backups.run(T + DAY));
  assert.equal(backups.status().error, null);
  done();
});

test('nothing to back up when the data is only in memory, or once the app is quitting', async () => {
  const db = new Db(':memory:');
  const backups = new Backups({ db, dir: os.tmpdir(), settings: () => ({}) });
  assert.equal(backups.status().possible, false);
  assert.equal(backups.due(T), false);
  assert.equal(await backups.run(T), null);
  const quitting = setup();
  const run = quitting.backups.run(T);
  quitting.backups.stop();
  quitting.db.close();
  await run;
  assert.deepEqual(quitting.events, [], 'not recorded as a failure');
  assert.equal(await quitting.backups.run(T + DAY), null, 'closed');
  fs.rmSync(quitting.dir, { recursive: true, force: true });
});

test('start looks a minute after starting, then every hour, and stop ends that', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { backups, done } = setup();
  let checks = 0;
  backups.check = () => checks++;
  backups.start();
  t.mock.timers.tick(60_000);
  assert.equal(checks, 1);
  t.mock.timers.tick(3_600_000);
  assert.equal(checks, 2);
  backups.stop();
  t.mock.timers.tick(10 * 3_600_000);
  assert.equal(checks, 2);
  done();
});
