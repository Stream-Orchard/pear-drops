// The app's data, in one SQLite file (pear-drops.db in the data folder): the history, the drop
// archive, the startup cache and small saved state. Settings stay in settings.json, so they can
// be read and edited by hand and a damaged database can't take them with it; drop images stay
// files in drop-images/.
//
// Node's built-in node:sqlite, so there's no native module to build for each system. It's still
// marked as in development in Node, so everything that touches it is here: a change in a later
// Electron only touches this file.
const fs = require('fs');
const path = require('path');
const { DatabaseSync, backup } = require('node:sqlite');

const FILE = 'pear-drops.db';
// Copies of the database (backups.js makes them; a damaged database is replaced by the newest good one).
const BACKUPS = 'backups';

// Each step brings the schema up one version (PRAGMA user_version). Never edit a released step:
// add another.
const MIGRATIONS = [
  `CREATE TABLE events (seq INTEGER PRIMARY KEY, t INTEGER NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL);
   CREATE INDEX events_t ON events (t);
   CREATE INDEX events_type_t ON events (type, t);
   CREATE TABLE drops (id TEXT PRIMARY KEY, data TEXT NOT NULL);
   CREATE TABLE images (url TEXT PRIMARY KEY, file TEXT NOT NULL);
   CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
];

// The files older versions kept, copied in once by importFiles().
const OLD_FILES = { history: 'history.jsonl', drops: 'drops.json', cache: 'cache.json', security: 'security.json', updates: 'updates.json' };

// The startup cache is saved in parts, so a refresh only rewrites what changed: each category's
// streams (most of it) is a row of its own.
const CACHE = 'cache.';
const STREAMS = 'cache.streams.';

const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

// A backup's file name: when it was made (UTC), and the schema step it was made before, if it was
// made for an update. pear-drops-2026-10-18T09-12-00Z.db, pear-drops-2026-10-18T09-12-00Z-before-v2.db
const backupName = (at, before = null) => `pear-drops-${new Date(at).toISOString().slice(0, 19).replace(/:/g, '-')}Z${before ? `-before-v${before}` : ''}.db`;
const BACKUP_NAME = /^pear-drops-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z(?:-before-v(\d+))?\.db$/;

/** The backups in a backups folder, newest first: { file, name, at, before, size }. */
function listBackups(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {}
  return names
    .map((name) => {
      const m = BACKUP_NAME.exec(name);
      if (!m) return null;
      const file = path.join(dir, name);
      let size = 0;
      try {
        size = fs.statSync(file).size;
      } catch {}
      return { file, name, at: Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`), before: m[5] ? Number(m[5]) : null, size };
    })
    .filter(Boolean)
    .sort((a, b) => b.at - a.at || b.name.localeCompare(a.name));
}

/** Whether a file is a whole, readable database (SQLite's quick check). */
function checkFile(file) {
  let sql = null;
  try {
    sql = new DatabaseSync(file, { readOnly: true });
    return sql.prepare('PRAGMA quick_check').get()?.quick_check === 'ok';
  } catch {
    return false;
  } finally {
    try {
      sql?.close();
    } catch {}
  }
}

/** Removes a database file and the two SQLite keeps beside it. */
function removeDb(file) {
  for (const suffix of ['', '-wal', '-shm', '-journal']) fs.rmSync(`${file}${suffix}`, { force: true });
}

class Db {
  /**
   * file: the database file, or ':memory:' (tests). backups: the folder for the copy made before
   * a schema update (none for ':memory:'). migrations: tests only.
   */
  constructor(file, { backups = null, migrations = MIGRATIONS } = {}) {
    this.file = file;
    this.backups = backups;
    this.migrations = migrations;
    this.sql = new DatabaseSync(file);
    try {
      this.sql.exec('PRAGMA busy_timeout = 2000');
      if (file !== ':memory:') this.sql.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL');
      this.migrate();
    } catch (err) {
      this.sql.close();
      throw err;
    }
    this.statements = new Map();
    this.cacheRows = new Map(); // the startup cache's rows as last written, so unchanged ones aren't written again
    this.cache = { load: () => this.loadCache(), save: (data) => this.saveCache(data) };
  }

  migrate() {
    const at = this.sql.prepare('PRAGMA user_version').get().user_version;
    // An update that changes the schema: a copy first, so a mistake in the new step can't cost the data.
    if (at > 0 && at < this.migrations.length && this.backups) {
      fs.mkdirSync(this.backups, { recursive: true });
      const copy = path.join(this.backups, backupName(Date.now(), at + 1));
      this.sql.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
    }
    for (let v = at; v < this.migrations.length; v++) {
      this.transaction(() => {
        this.sql.exec(this.migrations[v]);
        this.sql.exec(`PRAGMA user_version = ${v + 1}`);
      });
    }
  }

  /** A prepared statement, made once. */
  q(text) {
    if (!this.statements.has(text)) this.statements.set(text, this.sql.prepare(text));
    return this.statements.get(text);
  }

  /** Runs fn() as one all-or-nothing write. */
  transaction(fn) {
    if (this.sql.isTransaction) return fn();
    this.sql.exec('BEGIN');
    try {
      const out = fn();
      this.sql.exec('COMMIT');
      return out;
    } catch (err) {
      this.sql.exec('ROLLBACK');
      throw err;
    }
  }

  get isOpen() {
    return this.sql.isOpen;
  }

  /**
   * Copies the database to `file` while the app carries on (a few pages at a time), as one file
   * that opens on its own, and checks the copy. Returns its size.
   */
  async backupTo(file) {
    const part = `${file}.part`;
    removeDb(part);
    try {
      await backup(this.sql, part, { rate: 256 });
      const copy = new DatabaseSync(part);
      try {
        copy.exec('PRAGMA journal_mode = DELETE'); // the copy is in WAL mode, like the original
      } finally {
        copy.close();
      }
      if (!checkFile(part)) throw new Error('the copy didn’t pass its check');
      fs.renameSync(part, file);
    } catch (err) {
      removeDb(part);
      throw err;
    }
    return fs.statSync(file).size;
  }

  close() {
    if (!this.sql.isOpen) return;
    try {
      this.sql.exec('PRAGMA optimize');
    } catch {}
    this.sql.close();
  }

  // ------------------------------------------------------------------ history events

  /** Saves events ({ t, type, ... }), returning the last one's row number. */
  addEvents(list) {
    const insert = this.q('INSERT INTO events (t, type, data) VALUES (?, ?, ?)');
    return this.transaction(() => {
      let seq = null;
      for (const e of list) seq = Number(insert.run(e.t, e.type, JSON.stringify(e)).lastInsertRowid);
      return seq;
    });
  }

  addEvent(e) {
    return this.addEvents([e]);
  }

  /** Events from `since` to `until` (inclusive) in time order, and only those saved after row `after`. */
  events({ since = 0, until = Number.MAX_SAFE_INTEGER, after = 0 } = {}) {
    return this.q('SELECT seq, data FROM events WHERE t >= ? AND t <= ? AND seq > ? ORDER BY t, seq')
      .all(since, until, after)
      .map((r) => ({ seq: r.seq, e: parse(r.data) }))
      .filter((r) => r.e);
  }

  lastSeq() {
    return this.q('SELECT max(seq) AS n FROM events').get().n ?? 0;
  }

  firstEventAt() {
    return this.q('SELECT min(t) AS t FROM events').get().t ?? null;
  }

  lastEventAt(type) {
    return this.q('SELECT max(t) AS t FROM events WHERE type = ?').get(type).t ?? null;
  }

  countEvents(type, since = 0) {
    return this.q('SELECT count(*) AS n FROM events WHERE type = ? AND t >= ?').get(type, since).n;
  }

  /** Forgets events older than `before`. */
  pruneEvents(before) {
    return Number(this.q('DELETE FROM events WHERE t < ?').run(before).changes);
  }

  // ------------------------------------------------------------------ drop archive

  /** { id: entry } and { url: file name }. */
  loadDrops() {
    const drops = {};
    for (const r of this.q('SELECT id, data FROM drops').all()) {
      const entry = parse(r.data);
      if (entry) drops[r.id] = entry;
    }
    const images = {};
    for (const r of this.q('SELECT url, file FROM images').all()) images[r.url] = r.file;
    return { drops, images };
  }

  /** Writes changed drops ({ id: entry, or null to delete }) and images ({ url: file name or null }) together. */
  saveDrops(drops = {}, images = {}) {
    const putDrop = this.q('INSERT OR REPLACE INTO drops (id, data) VALUES (?, ?)');
    const dropDrop = this.q('DELETE FROM drops WHERE id = ?');
    const putImage = this.q('INSERT OR REPLACE INTO images (url, file) VALUES (?, ?)');
    const dropImage = this.q('DELETE FROM images WHERE url = ?');
    this.transaction(() => {
      for (const [id, entry] of Object.entries(drops)) entry ? putDrop.run(id, JSON.stringify(entry)) : dropDrop.run(id);
      for (const [url, file] of Object.entries(images)) file ? putImage.run(url, file) : dropImage.run(url);
    });
  }

  // ------------------------------------------------------------------ saved state

  /** A saved value (anything JSON can hold), or `fallback`. */
  get(key, fallback = null) {
    const row = this.q('SELECT value FROM state WHERE key = ?').get(key);
    const value = row ? parse(row.value) : undefined;
    return value === undefined ? fallback : value;
  }

  set(key, value) {
    if (value === undefined) this.q('DELETE FROM state WHERE key = ?').run(key);
    else this.q('INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
  }

  /** One saved value as { load(), save(value) }, for a module that keeps a small object (security.js, updates.js). */
  slot(key) {
    return { load: () => this.get(key, {}), save: (value) => this.set(key, value) };
  }

  // ------------------------------------------------------------------ startup cache

  loadCache() {
    const rows = this.q('SELECT key, value FROM state WHERE key >= ? AND key < ?').all(CACHE, 'cache/');
    if (!rows.length) return null;
    const c = {};
    const streams = new Map();
    for (const r of rows) {
      this.cacheRows.set(r.key, r.value);
      const value = parse(r.value);
      if (value === undefined) continue;
      if (r.key.startsWith(STREAMS)) streams.set(r.key.slice(STREAMS.length), value);
      else c[r.key.slice(CACHE.length)] = value;
    }
    // In the order they were saved (the keys are strings; the ids may not be).
    c.streams = (c.streamIds ?? []).filter((id) => streams.has(String(id))).map((id) => [id, streams.get(String(id))]);
    delete c.streamIds;
    return c;
  }

  /** Saves the startup cache, writing only the parts that changed since the last save. */
  saveCache(data) {
    const { streams = [], ...rest } = data;
    const next = new Map();
    for (const [k, v] of Object.entries({ ...rest, streamIds: streams.map(([id]) => id) })) if (v !== undefined) next.set(CACHE + k, JSON.stringify(v));
    for (const [id, entry] of streams) next.set(STREAMS + id, JSON.stringify(entry));
    const put = this.q('INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)');
    const remove = this.q('DELETE FROM state WHERE key = ?');
    this.transaction(() => {
      for (const [key, value] of next) if (this.cacheRows.get(key) !== value) put.run(key, value);
      for (const key of this.cacheRows.keys()) if (!next.has(key)) remove.run(key);
    });
    this.cacheRows = next;
  }

  // ------------------------------------------------------------------ files from older versions

  /**
   * Copies in what older versions kept in files (history.jsonl, drops.json, cache.json,
   * security.json, updates.json), once, in one go. The files are left as they were, so going
   * back to an older version still finds them. Returns the names of those copied in.
   */
  importFiles(dir) {
    if (this.get('imported')) return [];
    const read = (name) => {
      try {
        return fs.readFileSync(path.join(dir, name), 'utf8');
      } catch {
        return null;
      }
    };
    const found = [];
    this.transaction(() => {
      const history = read(OLD_FILES.history);
      if (history !== null) {
        const events = history
          .split('\n')
          .map((line) => line && parse(line))
          .filter((e) => e && Number.isFinite(e.t) && typeof e.type === 'string');
        this.addEvents(events);
        found.push(OLD_FILES.history);
      }
      const drops = parse(read(OLD_FILES.drops));
      if (drops && typeof drops === 'object') {
        this.saveDrops(drops.campaigns ?? {}, drops.images ?? {});
        found.push(OLD_FILES.drops);
      }
      const cache = parse(read(OLD_FILES.cache));
      if (cache && typeof cache === 'object') {
        this.saveCache(cache);
        found.push(OLD_FILES.cache);
      }
      for (const key of ['security', 'updates']) {
        const value = parse(read(OLD_FILES[key]));
        if (value && typeof value === 'object') {
          this.set(key, value);
          found.push(OLD_FILES[key]);
        }
      }
      this.set('imported', { at: Date.now(), files: found });
    });
    return found;
  }
}

/**
 * Opens (or creates) the database in the data folder. One that can't be opened (damaged) is
 * moved aside as pear-drops.db.broken-<time> and replaced by a copy of the newest backup that
 * passes its check (`db.restored` says which). With no good backup a new one is started, which
 * copies in the older versions' files again if they're still there (`db.restored.from` is null).
 */
function openDb(dir, { log = () => {} } = {}) {
  const file = path.join(dir, FILE);
  const backups = path.join(dir, BACKUPS);
  try {
    fs.mkdirSync(dir, { recursive: true });
    return new Db(file, { backups });
  } catch (err) {
    const aside = `${file}.broken-${Date.now()}`;
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.renameSync(`${file}${suffix}`, `${aside}${suffix}`);
      } catch {}
    }
    for (const b of listBackups(backups)) {
      if (!checkFile(b.file)) continue;
      try {
        fs.copyFileSync(b.file, file);
        const db = new Db(file, { backups });
        db.restored = { from: b.name, at: b.at, error: err.message };
        log(`The data file couldn't be opened (${err.message}): restored the backup from ${new Date(b.at).toISOString()}`);
        return db;
      } catch {
        removeDb(file);
      }
    }
    log(`The data file couldn't be opened (${err.message}): starting a new one`);
    try {
      const db = new Db(file, { backups });
      db.restored = { from: null, at: null, error: err.message };
      return db;
    } catch (again) {
      // The folder can't be written: this run keeps its data in memory.
      log(`The data file couldn't be created (${again.message}): nothing will be saved this run`);
      return new Db(':memory:');
    }
  }
}

module.exports = { Db, openDb, listBackups, backupName, checkFile, removeDb, FILE, BACKUPS, OLD_FILES, MIGRATIONS };
