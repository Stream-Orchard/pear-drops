// How often each category has a live stream that counts for its drops: one mark per hour
// over the last week (live or not), so Smart order can catch rarely live drops while
// they're on. Saved with the startup cache.
const HOUR = 3600_000;
const WEEK_HOURS = 7 * 24;
const MIN_HOURS = 6; // hours seen before a category's rate is trusted

class Availability {
  /** saved: { [categoryId]: { [hour]: 0 | 1 } }, as written by toJSON(). */
  constructor(saved = {}) {
    this.byCategory = new Map(Object.entries(saved ?? {}).map(([id, hours]) => [String(id), { ...hours }]));
  }

  /** One look at a category at time t: was a stream that counts for its drops live? */
  note(categoryId, t, live) {
    const key = String(categoryId);
    const hour = Math.floor(t / HOUR);
    const hours = this.byCategory.get(key) ?? {};
    hours[hour] = hours[hour] || live ? 1 : 0; // one live look makes the hour live
    for (const h of Object.keys(hours)) if (Number(h) <= hour - WEEK_HOURS) delete hours[h];
    this.byCategory.set(key, hours);
  }

  /** A stretch known to have had a stream live (a watch session): every hour it touches is live. */
  noteLive(categoryId, from, to) {
    for (let t = Math.floor(from / HOUR) * HOUR; t <= to; t += HOUR) this.note(categoryId, t, true);
  }

  /** This week's hours seen and how many had a stream live, and when the first of them began. */
  seen(categoryId, now = Date.now()) {
    const hours = this.byCategory.get(String(categoryId)) ?? {};
    const after = Math.floor(now / HOUR) - WEEK_HOURS;
    const seen = Object.keys(hours).map(Number).filter((h) => h > after);
    return {
      hours: seen.length,
      live: seen.filter((h) => hours[h]).length,
      since: seen.length ? Math.min(...seen) * HOUR : null,
    };
  }

  /** The share of this week's hours seen with a stream live (0 to 1), or null until there's enough to say. */
  rate(categoryId, now = Date.now()) {
    const { hours, live } = this.seen(categoryId, now);
    return hours < MIN_HOURS ? null : live / hours;
  }

  toJSON() {
    return Object.fromEntries(this.byCategory);
  }
}

module.exports = { Availability, HOUR, MIN_HOURS, WEEK_HOURS };
