// Settings › Connected apps › Activity: what went between Pear Drops and each linked app this run,
// from Grapevine's `message` event (every request, reply, error and event, each way), plus what
// connected.js notices itself (connected, disconnected, a test, a message Grapevine dropped).
//
// Kept in memory only, the last MAX entries. The link's heartbeat (link.ping, every 20 seconds) isn't
// an entry: it's counted, and its last round trip shown, so the log is the messages that matter.
const MAX = 500;
const MIN = 60_000;
const MINUTES = 30; // the traffic chart's span
const PING = 'link.ping';

const blank = () => ({ sent: 0, received: 0, bytesOut: 0, bytesIn: 0, problems: 0, pings: 0, ping: null, since: null });
const isProblem = (e) => e.kind === 'error' || e.tone === 'bad' || e.tone === 'warn';
const FILTERS = {
  all: () => true,
  out: (e) => e.dir === 'out',
  in: (e) => e.dir === 'in',
  problems: isProblem,
};

class ActivityLog {
  constructor({ max = MAX, now = Date.now } = {}) {
    this.max = max;
    this.now = now;
    this.entries = []; // oldest first
    this.n = 0;
    this.totals = new Map(); // app id -> blank()
    this.minutes = new Map(); // app id -> Map(minute -> { out, in, bad })
    this.started = now();
  }

  totalsOf(app) {
    if (!this.totals.has(app)) this.totals.set(app, blank());
    return this.totals.get(app);
  }

  count(app, at, key) {
    if (!this.minutes.has(app)) this.minutes.set(app, new Map());
    const m = this.minutes.get(app);
    const minute = Math.floor(at / MIN);
    const slot = m.get(minute) ?? { out: 0, in: 0, bad: 0 };
    slot[key] += 1;
    m.set(minute, slot);
    for (const k of m.keys()) if (k < minute - MINUTES * 2) m.delete(k);
  }

  push(entry) {
    const e = { n: ++this.n, ...entry };
    this.entries.push(e);
    if (this.entries.length > this.max) this.entries.splice(0, this.entries.length - this.max);
    if (isProblem(e) && e.app) {
      this.totalsOf(e.app).problems += 1;
      this.count(e.app, e.at, 'bad');
    }
    return e;
  }

  /** One of Grapevine's messages ({ at, app, dir, kind, method, id, ms, bytes, data }). */
  add(m) {
    const app = m.app ?? null;
    if (app) {
      const t = this.totalsOf(app);
      t.since ??= m.at;
      if (m.dir === 'out') {
        t.sent += 1;
        t.bytesOut += m.bytes ?? 0;
      } else {
        t.received += 1;
        t.bytesIn += m.bytes ?? 0;
      }
    }
    if (m.method === PING && m.kind !== 'error') {
      if (app) {
        const t = this.totalsOf(app);
        if (m.kind === 'request') t.pings += 1;
        if (m.kind === 'reply' && m.dir === 'in') t.ping = { at: m.at, ms: m.ms ?? null };
        else if (m.kind === 'request' && m.dir === 'in') t.ping = { at: m.at, ms: t.ping?.ms ?? null };
      }
      return null;
    }
    if (app) this.count(app, m.at, m.dir === 'out' ? 'out' : 'in');
    const { at, dir, kind, method = null, id, ms, bytes, data } = m;
    return this.push({ at, app, dir, kind, method, id, ms, bytes, data });
  }

  /** The link to an app ended: its heartbeat starts again with the next connection. */
  ended(app) {
    if (this.totals.has(app)) this.totals.get(app).ping = null;
  }

  /**
   * Something connected.js noticed: kind 'status' (connected, disconnected, a test) or 'note' (a
   * dropped message). `about: 'players'` for the wait to sign Kick players back in (a clock).
   */
  note(app, { kind = 'status', tone = '', text, about, at = this.now() }) {
    return this.push({ at, app: app ?? null, dir: null, kind, method: null, tone, text, ...(about ? { about } : {}) });
  }

  /**
   * A page of one app's entries, newest first: those older than entry `before` (the newest when
   * null) that pass `filter`. With the counts, the totals and the traffic chart's minutes.
   */
  page(app, { filter = 'all', before = null, limit = 10, now = this.now() } = {}) {
    const pass = FILTERS[filter] ?? FILTERS.all;
    const mine = this.entries.filter((e) => (e.app === app || e.app === null) && pass(e));
    const older = before === null ? mine : mine.filter((e) => e.n < before);
    const entries = older.slice(-Math.max(1, limit)).reverse();
    const problems = this.entries.filter((e) => (e.app === app || e.app === null) && isProblem(e)).length;
    return {
      entries,
      total: mine.length,
      newer: mine.length - older.length,
      problems,
      totals: { ...blank(), ...this.totals.get(app) },
      minutes: this.chart(app, now),
      started: this.started,
      latest: this.n,
    };
  }

  /** Messages a minute over the last 30 minutes, oldest first: { out, in, bad }. */
  chart(app, now = this.now()) {
    const m = this.minutes.get(app) ?? new Map();
    const last = Math.floor(now / MIN);
    return Array.from({ length: MINUTES }, (_, i) => m.get(last - MINUTES + 1 + i) ?? { out: 0, in: 0, bad: 0 });
  }
}

module.exports = { ActivityLog, MAX, MINUTES };
