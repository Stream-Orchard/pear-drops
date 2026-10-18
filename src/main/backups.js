// Backups of the app's database (db.js): a copy in the data folder's backups/ folder every day or
// every week (Settings › Privacy), keeping the last few. Each copy is checked as it's made, and a
// database that's found damaged at start is replaced by the newest good one (openDb in db.js).
// Copies made before a schema update (db.js too) are kept apart from these.
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const { listBackups, backupName, BACKUPS } = require('./db');

const DAY = 86_400_000;
const EVERY = { day: DAY, week: 7 * DAY, off: null };
const KEEP = [3, 7, 14];
const KEEP_BEFORE_UPDATE = 2; // copies made before a schema update
// How often it looks whether a backup is due, and the first look after starting (so the start
// isn't slowed). A backup this much early still counts, so a daily one doesn't drift later.
const CHECK_MS = 60 * 60_000;
const FIRST_CHECK_MS = 60_000;

class Backups extends EventEmitter {
  /**
   * db: the app's database. dir: the data folder. settings(): the app's settings (backupEvery,
   * backupKeep). history: where a backup that fails is recorded.
   */
  constructor({ db, dir, settings, history = null, log = () => {} }) {
    super();
    this.db = db;
    this.dir = path.join(dir, BACKUPS);
    this.settings = settings;
    this.history = history;
    this.log = log;
    this.running = null;
    this.error = null;
    this.timers = [];
    this.files = listBackups(this.dir);
  }

  get every() {
    const every = this.settings().backupEvery;
    return every in EVERY ? every : 'day';
  }

  get keep() {
    const keep = Number(this.settings().backupKeep);
    return KEEP.includes(keep) ? keep : KEEP[0];
  }

  /** Whether the app's data can be backed up at all (not when it's only in memory). */
  get possible() {
    return this.db.file !== ':memory:';
  }

  /** Whether a scheduled backup is due. */
  due(now = Date.now()) {
    const ms = EVERY[this.every];
    if (!ms || !this.possible) return false;
    const last = this.files.find((b) => !b.before);
    return !last || now - last.at >= ms - CHECK_MS;
  }

  start() {
    const first = setTimeout(() => this.check(), FIRST_CHECK_MS);
    const every = setInterval(() => this.check(), CHECK_MS);
    first.unref?.();
    every.unref?.();
    this.timers = [first, every];
    return this;
  }

  stop() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.stopped = true;
  }

  /** Backs up if one is due. */
  async check(now = Date.now()) {
    if (this.due(now)) await this.run(now);
  }

  /** Backs up now (once at a time). Resolves to the new copy's file, or null. */
  run(now = Date.now()) {
    if (this.running) return this.running;
    if (!this.possible || !this.db.isOpen) return Promise.resolve(null);
    this.running = this.make(now).finally(() => {
      this.running = null;
      this.files = listBackups(this.dir);
      this.emit('change');
    });
    this.emit('change');
    return this.running;
  }

  async make(now) {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const file = path.join(this.dir, backupName(now));
      await this.db.backupTo(file);
      this.error = null;
      this.prune();
      return file;
    } catch (err) {
      // Quitting meanwhile isn't a failure.
      if (this.stopped || !this.db.isOpen) return null;
      this.error = err.message;
      this.log(`The data couldn't be backed up: ${err.message}`);
      this.history?.add('backup-failed', { text: `Couldn’t back up the app’s data: ${err.message}` });
      return null;
    }
  }

  /** Removes the oldest copies beyond the number to keep (after Copies to keep is changed). */
  rotate() {
    this.prune();
    this.files = listBackups(this.dir);
    this.emit('change');
  }

  prune() {
    const all = listBackups(this.dir);
    const extra = [...all.filter((b) => !b.before).slice(this.keep), ...all.filter((b) => b.before).slice(KEEP_BEFORE_UPDATE)];
    for (const b of extra) fs.rmSync(b.file, { force: true });
  }

  /** For Settings › Privacy. */
  status() {
    const last = this.files.find((b) => !b.before);
    return {
      every: this.every,
      keep: this.keep,
      possible: this.possible,
      last: last ? { at: last.at, size: last.size } : null,
      count: this.files.length,
      size: this.files.reduce((sum, b) => sum + b.size, 0),
      running: !!this.running,
      error: this.error,
    };
  }
}

module.exports = { Backups, EVERY, KEEP };
