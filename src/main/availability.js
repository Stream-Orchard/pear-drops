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

  /** The share of this week's hours seen with a stream live (0 to 1), or null until there's enough to say. */
  rate(categoryId, now = Date.now()) {
    const hours = this.byCategory.get(String(categoryId));
    if (!hours) return null;
    const since = Math.floor(now / HOUR) - WEEK_HOURS;
    const seen = Object.entries(hours).filter(([h]) => Number(h) > since);
    if (seen.length < MIN_HOURS) return null;
    return seen.filter(([, live]) => live).length / seen.length;
  }

  toJSON() {
    return Object.fromEntries(this.byCategory);
  }
}

module.exports = { Availability, HOUR, MIN_HOURS };
