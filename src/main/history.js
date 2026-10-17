// Permanent, granular history of everything the farmer does: credits, claims,
// unlocks, stalls, reloads, crashes, stream switches, conflicts, completions and
// app events. Stored as one JSON object per line in the app's data folder and
// aggregated here for the History view and its overview dashboard.
const fs = require('fs');
const path = require('path');

const DAY = 86_400_000;
const KEEP_DAYS = 400;
const COMPACT_BYTES = 25 * 1024 * 1024;
// A watch session left without an end stops this long after the last thing heard from it
// (credits come about every 2 minutes).
const CUT_GRACE_MS = 5 * 60_000;

// Event types, grouped for filtering in the UI.
const GROUPS = {
  progress: ['credit', 'credit-elsewhere'],
  rewards: ['unlock', 'claim', 'claim-failed', 'campaign-complete', 'category-complete', 'campaign-ended', 'campaign-back'],
  watching: ['watch-start', 'watch-end', 'priority', 'decision'],
  problems: ['stall', 'reload', 'crash', 'offline', 'conflict', 'error', 'not-eligible'],
  app: ['start', 'pause', 'resume', 'login', 'logout', 'wake', 'follow', 'unfollow'],
};
const GROUP_OF = Object.fromEntries(Object.entries(GROUPS).flatMap(([g, types]) => types.map((t) => [t, g])));

class History {
  constructor(dir) {
    this.file = path.join(dir, 'history.jsonl');
    this.events = [];
    this.seq = 0;
    this.writing = Promise.resolve();
    this.listeners = new Set();
  }

  load() {
    let text = '';
    try {
      text = fs.readFileSync(this.file, 'utf8');
    } catch {
      return this;
    }
    const cutoff = Date.now() - KEEP_DAYS * DAY;
    for (const line of text.split('\n')) {
      if (!line) continue;
      try {
        const e = JSON.parse(line);
        if (e.t >= cutoff) this.events.push(e);
      } catch {}
    }
    this.events.sort((a, b) => a.t - b.t);
    this.seq = this.events.length;
    if (text.length > COMPACT_BYTES) this.rewrite();
    return this;
  }

  rewrite() {
    try {
      fs.writeFileSync(this.file, this.events.map((e) => JSON.stringify(e)).join('\n') + '\n');
    } catch {}
  }

  /** Records one event. `data` holds whatever context applies (campaign, channel, delta…). */
  add(type, data = {}) {
    const e = { id: `${Date.now().toString(36)}-${(this.seq++).toString(36)}`, t: data.t ?? Date.now(), type, ...data };
    if (data.t === undefined) e.t = Date.now();
    this.events.push(e);
    const line = JSON.stringify(e) + '\n';
    this.writing = this.writing.then(() => fs.promises.appendFile(this.file, line).catch(() => {}));
    this.listeners.forEach((fn) => fn(e));
    return e;
  }

  /** Adds many events at once (demo history), keeping order. */
  addMany(list) {
    this.events.push(...list.map((e) => ({ id: `${e.t.toString(36)}-${(this.seq++).toString(36)}`, ...e })));
    this.events.sort((a, b) => a.t - b.t);
    this.rewrite();
  }

  onAdd(fn) {
    this.listeners.add(fn);
  }

  // ------------------------------------------------------------------ views

  /**
   * Everything the History view shows, in one call.
   * opts: { since, campaignId, groups: [..], text, limit, now }
   */
  view({ since = 0, campaignId = null, groups = null, text = '', limit = 400, now = Date.now() } = {}) {
    const inRange = this.events.filter((e) => e.t >= since && e.t <= now);
    const forCampaign = (e) => !campaignId || e.campaignId === campaignId || (e.campaignIds ?? []).includes(campaignId);
    const scoped = inRange.filter(forCampaign);
    const sessions = this.sessions(inRange, now).filter((s) => !campaignId || s.campaignIds.includes(campaignId));

    return {
      totals: this.totals(scoped, sessions),
      daily: this.daily(scoped, sessions, since, now),
      hourly: this.hourly(sessions),
      campaigns: this.campaigns(inRange, this.sessions(inRange, now)),
      channels: this.channels(sessions),
      sessions: sessions.slice(-200).reverse(),
      series: campaignId ? this.series(campaignId, since) : null,
      events: this.timeline(scoped, { groups, text, limit }),
      first: this.events[0]?.t ?? null,
    };
  }

  /**
   * Pairs watch-start / watch-end into watch sessions. One left without an end (the app was
   * quit by force, crashed or restarted mid-stream) ends when the next one starts or the app
   * starts again, but no later than a few minutes after the last thing heard from it: only one
   * stream is ever watched at a time. The last one still going runs to `now`.
   */
  sessions(events, now = Date.now()) {
    const open = new Map();
    const out = [];
    const cut = (t) => {
      for (const s of open.values()) out.push({ ...s, end: Math.max(s.start, Math.min(t, s.lastAt + CUT_GRACE_MS)), reason: s.reason ?? 'App closed', cut: true });
      open.clear();
    };
    for (const e of events) {
      if (e.type === 'start') cut(e.t);
      if (e.type === 'watch-start') {
        cut(e.t);
        open.set(e.session, {
          session: e.session,
          start: e.t,
          end: null,
          slug: e.slug,
          channel: e.channel,
          avatar: e.avatar,
          category: e.category,
          categoryId: e.categoryId,
          campaignIds: e.campaignIds ?? [],
          campaigns: e.campaigns ?? [],
          manual: !!e.manual,
          credited: 0,
          stalls: 0,
          reloads: 0,
          reason: null,
          lastAt: e.t,
        });
      } else if (open.has(e.session)) {
        const s = open.get(e.session);
        s.lastAt = e.t;
        if (e.type === 'credit') s.credited += e.delta ?? 0;
        if (e.type === 'stall') s.stalls += 1;
        if (e.type === 'reload' || e.type === 'crash') s.reloads += 1;
        if (e.type === 'watch-end') {
          s.end = e.t;
          s.reason = e.reason ?? null;
          out.push(s);
          open.delete(e.session);
        }
      }
    }
    for (const s of open.values()) out.push({ ...s, end: null, open: true });
    return out
      .map((s) => {
        const ms = (s.end ?? now) - s.start;
        return { ...s, ms, efficiency: ms > 60_000 ? Math.min(1, s.credited / (ms / 60_000)) : null };
      })
      .sort((a, b) => a.start - b.start);
  }

  totals(events, sessions) {
    const count = (type) => events.filter((e) => e.type === type).length;
    const watchMs = sessions.reduce((sum, s) => sum + s.ms, 0);
    const credited = events.filter((e) => e.type === 'credit').reduce((sum, e) => sum + (e.delta ?? 0), 0);
    return {
      watchMs,
      credited,
      efficiency: watchMs > 60_000 ? Math.min(1, credited / (watchMs / 60_000)) : null,
      claims: count('claim'),
      unlocks: count('unlock'),
      completed: count('campaign-complete'),
      stalls: count('stall'),
      reloads: count('reload') + count('crash'),
      offline: count('offline'),
      conflicts: count('conflict'),
      elsewhere: events.filter((e) => e.type === 'credit-elsewhere').reduce((sum, e) => sum + (e.delta ?? 0), 0),
      sessions: sessions.length,
      channels: new Set(sessions.map((s) => s.slug)).size,
    };
  }

  /** Per day: credited minutes and watched minutes (for the activity chart). */
  daily(events, sessions, since, now) {
    const start = new Date(Math.max(since || 0, now - 60 * DAY, this.events[0]?.t ?? now));
    start.setHours(0, 0, 0, 0);
    const days = [];
    for (let d = start.getTime(); d <= now; d += DAY) days.push({ day: d, credited: 0, watched: 0, claims: 0 });
    const slot = (t) => days[Math.floor((t - start.getTime()) / DAY)];
    for (const e of events) {
      const s = slot(e.t);
      if (!s) continue;
      if (e.type === 'credit') s.credited += e.delta ?? 0;
      if (e.type === 'claim') s.claims += 1;
    }
    for (const sess of sessions) {
      // Split each session across the days it covers.
      let t = sess.start;
      const end = sess.end ?? now;
      while (t < end) {
        const dayEnd = new Date(t);
        dayEnd.setHours(24, 0, 0, 0);
        const part = Math.min(end, dayEnd.getTime()) - t;
        const s = slot(t);
        if (s) s.watched += part / 60_000;
        t += part;
      }
    }
    return days.map((d) => ({ ...d, watched: Math.round(d.watched) }));
  }

  /** Minutes watched by hour of day (0-23), for the "when you farm" heatmap. */
  hourly(sessions) {
    const hours = new Array(24).fill(0);
    for (const s of sessions) {
      let t = s.start;
      const end = s.end ?? Date.now();
      while (t < end) {
        const next = new Date(t);
        next.setMinutes(60, 0, 0);
        const part = Math.min(end, next.getTime()) - t;
        hours[new Date(t).getHours()] += part / 60_000;
        t += part;
      }
    }
    return hours.map(Math.round);
  }

  /** One summary per drop campaign seen in the range. */
  campaigns(events, sessions) {
    const map = new Map();
    const get = (e) => {
      if (!map.has(e.campaignId)) {
        map.set(e.campaignId, { campaignId: e.campaignId, campaign: e.campaign, category: e.category, categoryId: e.categoryId, credited: 0, units: 0, required: 0, claims: 0, stalls: 0, watchMs: 0, firstAt: e.t, lastAt: e.t, complete: false, rewards: [] });
      }
      const c = map.get(e.campaignId);
      c.campaign ??= e.campaign;
      c.category ??= e.category;
      c.lastAt = Math.max(c.lastAt, e.t);
      return c;
    };
    for (const e of events) {
      if (!e.campaignId) continue;
      const c = get(e);
      if (e.type === 'credit') {
        c.credited += e.delta ?? 0;
        c.units = e.units ?? c.units;
      }
      if (e.required) c.required = Math.max(c.required, e.required);
      if (e.type === 'claim') {
        c.claims += 1;
        c.rewards.push({ name: e.reward, image: e.rewardImage, t: e.t });
      }
      if (e.type === 'stall') c.stalls += 1;
      if (e.type === 'campaign-complete') c.complete = true;
    }
    for (const s of sessions) {
      for (const id of s.campaignIds) {
        const c = map.get(id);
        if (c) c.watchMs += s.ms;
      }
    }
    return [...map.values()].sort((a, b) => b.lastAt - a.lastAt);
  }

  channels(sessions) {
    const map = new Map();
    for (const s of sessions) {
      if (!map.has(s.slug)) map.set(s.slug, { slug: s.slug, channel: s.channel, avatar: s.avatar, sessions: 0, watchMs: 0, credited: 0, stalls: 0, lastAt: 0 });
      const c = map.get(s.slug);
      c.sessions += 1;
      c.watchMs += s.ms;
      c.credited += s.credited;
      c.stalls += s.stalls;
      c.lastAt = Math.max(c.lastAt, s.end ?? Date.now());
    }
    return [...map.values()]
      .map((c) => ({ ...c, efficiency: c.watchMs > 60_000 ? Math.min(1, c.credited / (c.watchMs / 60_000)) : null }))
      .sort((a, b) => b.watchMs - a.watchMs);
  }

  /** A campaign's progress units over time, from its credit events. */
  series(campaignId, since = 0) {
    return this.events.filter((e) => e.campaignId === campaignId && e.type === 'credit' && e.t >= since && e.units !== undefined).map((e) => [e.t, e.units]);
  }

  timeline(events, { groups, text, limit }) {
    const wanted = groups?.length ? new Set(groups) : null;
    const q = text?.trim().toLowerCase();
    const out = [];
    for (let i = events.length - 1; i >= 0 && out.length < limit; i--) {
      const e = events[i];
      if (wanted && !wanted.has(GROUP_OF[e.type])) continue;
      if (q && ![e.text, e.campaign, e.channel, e.reward, e.category, e.reason].some((v) => v && String(v).toLowerCase().includes(q))) continue;
      out.push({ ...e, group: GROUP_OF[e.type] ?? 'app' });
    }
    return out;
  }
}

module.exports = { History, GROUPS, GROUP_OF };
