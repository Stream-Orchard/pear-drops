const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Db, openDb, listBackups, backupName, checkFile, FILE, BACKUPS, MIGRATIONS } = require('../../../src/main/db');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pd-db-'));

test('a new database gets the current schema, and opening it again changes nothing', () => {
  const dir = tmp();
  const db = openDb(dir);
  assert.equal(db.sql.prepare('PRAGMA user_version').get().user_version, 1);
  assert.equal(db.sql.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  db.set('k', { a: 1 });
  db.close();
  db.close(); // twice is fine
  assert.equal(db.isOpen, false);
  const again = openDb(dir);
  assert.deepEqual(again.get('k'), { a: 1 });
  again.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('events: by time range, after a row, counted, first and last', () => {
  const db = new Db(':memory:');
  const t = 1_000_000;
  const seq = db.addEvents([
    { t: t + 30, type: 'claim', n: 3 },
    { t: t + 10, type: 'start', n: 1 },
    { t: t + 20, type: 'claim', n: 2 },
  ]);
  assert.equal(seq, 3);
  assert.equal(db.lastSeq(), 3);
  assert.deepEqual(db.events().map((r) => r.e.n), [1, 2, 3], 'in time order, not the order saved');
  assert.deepEqual(db.events({ since: t + 15, until: t + 25 }).map((r) => r.e.n), [2]);
  assert.deepEqual(db.events({ after: 1 }).map((r) => r.e.n), [1, 2], 'only rows saved after the first');
  assert.equal(db.countEvents('claim'), 2);
  assert.equal(db.countEvents('claim', t + 25), 1);
  assert.equal(db.firstEventAt(), t + 10);
  assert.equal(db.lastEventAt('claim'), t + 30);
  assert.equal(db.lastEventAt('watch-start'), null);
  assert.equal(db.pruneEvents(t + 15), 1);
  assert.equal(db.firstEventAt(), t + 20);
  db.sql.prepare("INSERT INTO events (t, type, data) VALUES (?, 'x', 'not json')").run(t + 40);
  assert.equal(db.events().length, 2, 'a row that is not JSON is skipped');
});

test('a write that fails part way leaves nothing behind', () => {
  const db = new Db(':memory:');
  assert.throws(() => db.addEvents([{ t: 1, type: 'start' }, { t: null, type: 'start' }]));
  assert.equal(db.lastSeq(), 0);
  assert.equal(db.transaction(() => db.transaction(() => 'inside one already')), 'inside one already');
});

test('saved state: any JSON value, a fallback when missing, and slots', () => {
  const db = new Db(':memory:');
  assert.equal(db.get('missing'), null);
  assert.equal(db.get('missing', 5), 5);
  db.set('n', 0);
  assert.equal(db.get('n', 5), 0);
  db.set('n', undefined);
  assert.equal(db.get('n', 5), 5, 'undefined removes it');
  const slot = db.slot('updates');
  assert.deepEqual(slot.load(), {});
  slot.save({ auto: false });
  assert.deepEqual(db.get('updates'), { auto: false });
});

test('drops and images: written and removed together', () => {
  const db = new Db(':memory:');
  db.saveDrops({ a: { raw: { id: 'a' } }, b: { raw: { id: 'b' } } }, { 'https://x/a.png': 'a.png' });
  db.saveDrops({ a: null }, { 'https://x/a.png': null, 'https://x/b.png': 'b.png' });
  assert.deepEqual(db.loadDrops(), { drops: { b: { raw: { id: 'b' } } }, images: { 'https://x/b.png': 'b.png' } });
});

test('the startup cache is saved in parts, and only the parts that changed are written', () => {
  const dir = tmp();
  const db = openDb(dir);
  assert.equal(db.cache.load(), null, 'nothing saved yet');
  const data = { savedAt: 1, campaigns: [{ id: 'a' }], streams: [[2, [{ slug: 'b' }]], [1, [{ slug: 'a' }]]], stats: { claims: 1 } };
  db.cache.save(data);
  const written = [];
  const put = db.q('INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)');
  const run = put.run.bind(put);
  put.run = (key, value) => (written.push(key), run(key, value));
  db.cache.save({ ...data, savedAt: 2, streams: [[2, [{ slug: 'b' }]], [1, [{ slug: 'a2' }]]] });
  assert.deepEqual(written.sort(), ['cache.savedAt', 'cache.streams.1']);
  db.cache.save({ ...data, savedAt: 2, streams: [[2, [{ slug: 'b' }]]] });
  db.close();
  const next = openDb(dir); // the next start
  assert.deepEqual(next.cache.load(), { savedAt: 2, campaigns: [{ id: 'a' }], stats: { claims: 1 }, streams: [[2, [{ slug: 'b' }]]] }, 'a category gone from the cache is removed');
  next.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an older version’s files are copied in once, and left where they were', () => {
  const dir = tmp();
  const t = Date.now();
  const write = (name, text) => fs.writeFileSync(path.join(dir, name), text);
  write('history.jsonl', `${JSON.stringify({ id: 'a', t, type: 'start' })}\nnot json\n${JSON.stringify({ t: t + 1, type: 'pause' })}\n{"type":"no time"}\n`);
  write('drops.json', JSON.stringify({ version: 1, campaigns: { c1: { raw: { id: 'c1' } } }, images: { 'https://x/i.png': 'i.png' } }));
  write('cache.json', JSON.stringify({ savedAt: t, campaigns: [{ id: 'c1' }], streams: [[7, [{ slug: 's' }]]] }));
  write('security.json', JSON.stringify({ migrated: true }));
  write('updates.json', 'not json');
  const db = openDb(dir);
  assert.deepEqual(db.importFiles(dir), ['history.jsonl', 'drops.json', 'cache.json', 'security.json']);
  assert.deepEqual(db.events().map((r) => r.e.type), ['start', 'pause']);
  assert.deepEqual(Object.keys(db.loadDrops().drops), ['c1']);
  assert.deepEqual(db.cache.load().streams, [[7, [{ slug: 's' }]]]);
  assert.deepEqual(db.get('security'), { migrated: true });
  assert.equal(db.get('updates'), null);
  assert.ok(fs.existsSync(path.join(dir, 'history.jsonl')), 'the old files stay');
  assert.deepEqual(db.importFiles(dir), [], 'only once');
  assert.equal(db.events().length, 2);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a first start with no old files records that, so nothing is copied in later', () => {
  const dir = tmp();
  const db = openDb(dir);
  assert.deepEqual(db.importFiles(dir), []);
  fs.writeFileSync(path.join(dir, 'security.json'), '{}');
  assert.deepEqual(db.importFiles(dir), []);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a damaged database is moved aside and a new one started', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, FILE), 'this is not a database, just some bytes');
  const logged = [];
  const db = openDb(dir, { log: (text) => logged.push(text) });
  db.set('ok', true);
  assert.equal(db.get('ok'), true);
  assert.match(logged[0], /couldn't be opened.*starting a new one/);
  assert.deepEqual(db.restored, { from: null, at: null, error: 'file is not a database' }, 'with no backup to put back');
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith(`${FILE}.broken-`)), 'kept, in case it can be rescued');
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a data folder that can’t be written keeps this run’s data in memory', () => {
  const file = path.join(tmp(), 'a file, not a folder');
  fs.writeFileSync(file, '');
  const logged = [];
  const db = openDb(file, { log: (text) => logged.push(text) });
  assert.equal(db.file, ':memory:');
  assert.match(logged.at(-1), /nothing will be saved/);
  db.set('ok', 1);
  assert.equal(db.get('ok'), 1);
});

test('a backup is one checked file that opens on its own, and a bad file fails the check', async () => {
  const dir = tmp();
  const db = openDb(dir);
  db.set('k', 1);
  const file = path.join(dir, 'copy.db');
  const size = await db.backupTo(file);
  assert.equal(size, fs.statSync(file).size);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith('copy')), ['copy.db'], 'no -wal or part file beside it');
  assert.equal(checkFile(file), true);
  const copy = new Db(file);
  assert.equal(copy.get('k'), 1);
  copy.close();
  fs.writeFileSync(path.join(dir, 'bad.db'), 'not a database');
  assert.equal(checkFile(path.join(dir, 'bad.db')), false);
  assert.equal(checkFile(path.join(dir, 'missing.db')), false);
  db.close();
  await assert.rejects(db.backupTo(path.join(dir, 'closed.db')));
  assert.ok(!fs.existsSync(path.join(dir, 'closed.db.part')), 'a failed copy leaves nothing');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('backups are listed newest first, by the time in their names', () => {
  const dir = tmp();
  const t = Date.UTC(2026, 9, 18, 9, 12, 0);
  for (const name of [backupName(t), backupName(t + 86_400_000), backupName(t, 2), 'notes.txt', 'pear-drops-x.db']) fs.writeFileSync(path.join(dir, name), 'x');
  assert.equal(backupName(t), 'pear-drops-2026-10-18T09-12-00Z.db');
  assert.deepEqual(
    listBackups(dir).map((b) => [b.name, b.at, b.before, b.size]),
    [
      ['pear-drops-2026-10-19T09-12-00Z.db', t + 86_400_000, null, 1],
      ['pear-drops-2026-10-18T09-12-00Z.db', t, null, 1],
      ['pear-drops-2026-10-18T09-12-00Z-before-v2.db', t, 2, 1],
    ],
  );
  assert.deepEqual(listBackups(path.join(dir, 'missing')), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an update that changes the schema backs up the data first', () => {
  const dir = tmp();
  const backups = path.join(dir, BACKUPS);
  const first = new Db(path.join(dir, FILE), { backups });
  first.set('k', 'before');
  first.close();
  assert.deepEqual(listBackups(backups), [], 'not for a new database');
  const next = [...MIGRATIONS, 'CREATE TABLE extra (x)'];
  const db = new Db(path.join(dir, FILE), { backups, migrations: next });
  const [copy] = listBackups(backups);
  assert.equal(copy.before, 2);
  const old = new Db(copy.file, { migrations: MIGRATIONS });
  assert.equal(old.sql.prepare('PRAGMA user_version').get().user_version, 1, 'the copy is from before the update');
  assert.equal(old.get('k'), 'before');
  old.close();
  db.close();
  const again = new Db(path.join(dir, FILE), { backups, migrations: next });
  assert.equal(listBackups(backups).length, 1, 'only once');
  again.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a damaged database is replaced by the newest backup that passes its check', async () => {
  const dir = tmp();
  const backups = path.join(dir, BACKUPS);
  fs.mkdirSync(backups);
  const db = openDb(dir);
  db.set('k', 'older');
  await db.backupTo(path.join(backups, backupName(Date.UTC(2026, 9, 17))));
  db.set('k', 'newer');
  await db.backupTo(path.join(backups, backupName(Date.UTC(2026, 9, 18))));
  db.close();
  fs.writeFileSync(path.join(backups, backupName(Date.UTC(2026, 9, 19))), 'damaged too');
  fs.writeFileSync(path.join(dir, FILE), 'this is not a database, just some bytes');
  fs.rmSync(path.join(dir, `${FILE}-wal`), { force: true });
  const logged = [];
  const restored = openDb(dir, { log: (text) => logged.push(text) });
  assert.equal(restored.get('k'), 'newer');
  assert.deepEqual(restored.restored, { from: backupName(Date.UTC(2026, 9, 18)), at: Date.UTC(2026, 9, 18), error: 'file is not a database' });
  assert.match(logged[0], /restored the backup from 2026-10-18/);
  assert.equal(listBackups(backups).length, 3, 'the backups stay');
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith(`${FILE}.broken-`)));
  restored.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
