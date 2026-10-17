const { EventEmitter } = require('events');
const { assetUrl } = require('./kick-api');

const MIN = 60_000;
const NOMINAL_RATE = 1; // progress units (minutes) per minute watched
const HISTORY_MS = 6 * 60 * MIN;
const PLAYER_STUCK_MS = 3 * MIN;
const MAX_CRASHES = 3; // within 10 minutes, before switching away
const MAX_STUCK_RELOADS = 2;
const ELIGIBLE_RECHECK_MS = 5 * MIN;
const CONFLICT_EVENTS = 3; // uncredited watch events (~2 min apart) before alerting
const CONFLICT_REPEAT_MS = 10 * MIN;

/** Emote / badge / Kick-native reward vs a game drop that needs a linked game account. */
function rewardKind(campaign, reward) {
  const name = reward.name.toLowerCase();
  if (/\b(emote|emoji)s?\b/.test(name)) return 'emote';
  if (/\bbadges?\b/.test(name)) return 'badge';
  if (campaign.organization?.name === 'KICK' && !campaign.connect_url) return 'kick';
  return 'game';
}

/** "3h 20m", "2d 4h", "45m": short spans for decision messages. */
function fmtSpan(ms) {
  const m = Math.max(0, Math.round(ms / MIN));
  if (m < 60) return `${m}m`;
  if (m < 48 * 60) return `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
  return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
}

class Farmer extends EventEmitter {
  constructor({ api, watcher, store, notify, history, archive = null, cacheFile = null }) {
    super();
    this.api = api;
    this.archive = archive; // local copies of campaigns and their images (archive.js)
    this.cacheFile = cacheFile;
    this.history = history;
    this.seenReady = null; // reward ids already unlocked (null until the first load)
    this.seenComplete = null; // campaign / category ids already complete
    this.lastErrorRecordAt = 0;
    this.watcher = watcher;
    this.store = store;
    this.notify = notify;
    this.running = false;
    this.paused = false;
    this.timer = null;
    this.ticking = false;
    this.nextTickAt = null;

    this.rawCampaigns = [];
    this.campaignsAt = 0;
    this.progress = [];
    this.followed = new Set();
    this.followedAt = 0;
    this.streams = new Map(); // categoryId -> { at, list }
    this.blacklist = new Map(); // slug -> until
    this.claimBackoff = new Map(); // rewardId -> until
    this.prevUnits = new Map(); // campaignId -> units

    this.model = { categories: [], campaigns: [] };
    this.current = null;
    // Account-wide: last time any watched campaign was credited. Not reset by
    // switching streams, so it shows when something else is taking the credit.
    this.lastCreditAt = null;
    this.lastAlertAt = null;
    this.eventsSinceCredit = 0;
    this.status = { code: 'starting', message: 'Loading drops…' };
    this.samples = []; // { t, units: { [campaignId]: n } }
    this.timeline = []; // { t, type: 'sent' | 'credit' | 'switch' | 'claim', ... }
    this.log = [];
    this.stats = {
      sessionStart: Date.now(),
      watchMs: 0,
      watchTickAt: null,
      earned: 0,
      claims: 0,
      switches: 0,
      reloads: 0,
      eventsSent: 0,
    };

    watcher.on('watch-event', ({ t }) => {
      this.stats.eventsSent += 1;
      this.pushTimeline({ t, type: 'sent' });
      if (this.current) {
        this.eventsSinceCredit += 1;
        this.checkCreditConflict(t);
      }
      this.changed();
    });
    watcher.on('status', () => this.changed());
    watcher.on('crashed', ({ reason }) => this.handleCrash(reason));
  }

  // ------------------------------------------------------------------ history

  /** Campaign + category names for a history event. */
  ctx(campaignId) {
    const c = this.model.campaigns.find((x) => x.id === campaignId);
    const raw = c ? null : this.rawCampaigns.find((x) => x.id === campaignId);
    const catId = c?.categoryId ?? raw?.category?.id;
    const cat = this.model.categories.find((x) => x.id === catId) ?? raw?.category;
    return { campaignId, campaign: c?.name ?? raw?.name, categoryId: catId, category: cat?.name, required: c?.targetUnits || undefined };
  }

  /** The current stream, for a history event. */
  streamCtx(cur = this.current) {
    return cur ? { session: cur.session, slug: cur.slug, channel: cur.username, avatar: cur.avatar, categoryId: cur.categoryId, category: cur.categoryName, campaignIds: cur.campaignIds } : {};
  }

  record(type, data) {
    this.history?.add(type, data);
  }

  // ------------------------------------------------------------------ lifecycle

  start() {
    if (this.running) return;
    this.running = true;
    this.addLog('info', 'Farmer started');
    this.record('start', { text: 'Farming started' });
    this.tick();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = null;
    this.stopWatching('App closed or signed out');
  }

  setPaused(paused) {
    this.paused = paused;
    if (paused) {
      this.lastCreditAt = null;
      this.lastAlertAt = null;
      this.eventsSinceCredit = 0;
      this.stopWatching('Paused');
      this.setStatus('paused', 'Paused');
      this.addLog('info', 'Paused');
      this.record('pause', { text: 'Paused' });
    } else {
      this.addLog('info', 'Resumed');
      this.record('resume', { text: 'Resumed' });
      this.tick();
    }
    this.changed();
  }

  schedule(ms) {
    clearTimeout(this.timer);
    if (!this.running) return;
    this.nextTickAt = Date.now() + ms;
    this.timer = setTimeout(() => this.tick(), ms);
  }

  async tick({ force = false } = {}) {
    if (!this.running || this.ticking) return;
    this.ticking = true;
    try {
      await this.refresh({ force });
      if (this.store.get().autoClaim) await this.claimReady();
      if (!this.paused) await this.decide();
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        // The Kick login expired or was signed out elsewhere.
        this.addLog('error', 'Kick says this login is no longer valid');
        this.ticking = false;
        this.emit('auth-lost');
        return;
      }
      this.addLog('error', `Refresh failed: ${err.message}`);
      this.setStatus('error', 'Could not reach Kick, retrying shortly');
      if (Date.now() - this.lastErrorRecordAt > 10 * MIN) {
        this.lastErrorRecordAt = Date.now();
        this.record('error', { text: `Could not reach Kick: ${err.message}` });
      }
    } finally {
      this.ticking = false;
      this.accumulateWatchTime();
      this.schedule(this.store.get().refreshSeconds * 1000);
      this.changed();
    }
  }

  // ------------------------------------------------------------------ data

  async refresh({ force }) {
    const now = Date.now();
    const settings = this.store.get();
    const campaignsTtl = (settings.campaignsMinutes ?? 10) * MIN;
    const followedTtl = (settings.followedMinutes ?? 15) * MIN;
    if (force || now - this.campaignsAt > campaignsTtl || !this.rawCampaigns.length) {
      this.rawCampaigns = await this.api.campaigns();
      this.campaignsAt = now;
    }
    if (force || now - this.followedAt > followedTtl) {
      try {
        this.followed = await this.api.followedSlugs();
        this.followedAt = now;
      } catch (err) {
        this.addLog('warn', `Could not load followed channels: ${err.message}`);
        this.followedAt = now - followedTtl + 2 * MIN;
      }
    }
    if (force || now - (this.emotesAt ?? 0) > 30 * MIN) {
      this.emotesAt = now;
      try {
        this.emotes = await this.api.myEmotes?.();
      } catch {
        this.emotes = this.emotes ?? [];
      }
    }
    this.progress = await this.api.progress();
    if (this.archive) this.recordArchiveChanges(this.archive.update(this.rawCampaigns, this.progress, now));
    this.trackProgress(now);
    this.buildModel();
    await this.refreshStreams({ force });
    this.buildModel();
    this.saveCache();
  }

  // ------------------------------------------------------------------ startup cache

  /**
   * Shows the last known drops, progress, live streams and follows straight away
   * on launch; the first refresh replaces them. Progress isn't used as a baseline,
   * so minutes earned while the app was closed aren't counted as this app's credit.
   */
  loadCache() {
    if (!this.cacheFile) return false;
    let c;
    try {
      c = JSON.parse(require('fs').readFileSync(this.cacheFile, 'utf8'));
    } catch {
      return false;
    }
    if (!c?.campaigns?.length) return false;
    this.rawCampaigns = c.campaigns;
    this.campaignsAt = c.savedAt ?? 0;
    this.progress = c.progress ?? [];
    this.followed = new Set(c.followed ?? []);
    this.followedAt = c.savedAt ?? 0;
    this.streams = new Map((c.streams ?? []).map(([id, entry]) => [id, entry]));
    this.buildModel();
    this.setStatus('starting', 'Refreshing from Kick…');
    return true;
  }

  saveCache() {
    if (!this.cacheFile || this.cacheTimer) return;
    this.cacheTimer = setTimeout(() => {
      this.cacheTimer = null;
      const data = { savedAt: Date.now(), campaigns: this.rawCampaigns, progress: this.progress, followed: [...this.followed], streams: [...this.streams] };
      require('fs').promises.writeFile(this.cacheFile, JSON.stringify(data)).catch(() => {});
    }, 2000);
  }

  /** Rebuilds the chart and live monitor's recent past from the saved history. */
  seedFromHistory() {
    if (!this.history) return;
    const since = Date.now() - HISTORY_MS;
    for (const e of this.history.events) {
      if (e.t < since) continue;
      if (e.type === 'credit' && e.campaignId && e.units !== undefined) {
        this.samples.push({ t: e.t, units: { [e.campaignId]: e.units } });
        this.timeline.push({ t: e.t, type: 'credit', campaignId: e.campaignId, delta: e.delta ?? 0 });
      } else if (e.type === 'claim') this.timeline.push({ t: e.t, type: 'claim', name: e.reward });
      else if (e.type === 'watch-start') this.timeline.push({ t: e.t, type: 'switch', name: e.channel });
    }
  }

  trackProgress(now) {
    const units = {};
    for (const p of this.progress) {
      const value = p.progress_units ?? 0;
      units[p.id] = value;
      const prev = this.prevUnits.get(p.id);
      if (prev !== undefined && value > prev) {
        const delta = value - prev;
        const watching = this.current?.campaignIds.includes(p.id);
        this.stats.earned += watching ? delta : 0;
        this.pushTimeline({ t: now, type: 'credit', campaignId: p.id, delta });
        if (!watching && this.current) {
          // Credit landed on a campaign we aren't watching: another session has it.
          this.addLog('alert', `+${delta} min went to ${p.name}, which this app isn't watching. Another Kick stream on your account is getting the credit`);
        }
        this.record(watching ? 'credit' : 'credit-elsewhere', {
          ...this.ctx(p.id),
          campaign: p.name,
          ...(watching ? this.streamCtx() : {}),
          delta,
          units: value,
          text: watching ? `+${delta} min (${value} total)` : `+${delta} min credited to a stream this app isn't watching`,
        });
        if (watching) {
          this.current.credited = (this.current.credited ?? 0) + delta;
          this.current.lastProgressAt = now;
          this.current.stallReloaded = false;
          this.lastCreditAt = now;
          this.lastAlertAt = null;
          this.eventsSinceCredit = 0;
          this.addLog('credit', `+${delta} min on ${p.name} (${value} total)`);
        }
      }
      this.prevUnits.set(p.id, value);
    }
    this.samples.push({ t: now, units });
    this.samples = this.samples.filter((s) => now - s.t < HISTORY_MS);
  }

  /** An image as the stored copy when there is one (it outlives Kick's), else Kick's. */
  img(url) {
    return this.archive ? this.archive.img(url) : url || null;
  }

  /** A campaign's rewards with what's claimed and ready, from its progress entry. */
  modelRewards(c, p, settings) {
    const units = p?.progress_units ?? p?.units ?? 0;
    return c.rewards
      .map((r) => {
        const pr = p?.rewards?.find((x) => x.id === r.id);
        const kind = rewardKind(c, r);
        const claimed = !!pr?.claimed;
        return {
          id: r.id,
          name: r.name,
          image: this.img(assetUrl(r.image_url)),
          preview: kind === 'game' ? null : this.emotePreview(r.name),
          required: r.required_units,
          kind,
          tracked: kind !== 'game' || settings.includeGameDrops,
          claimed,
          ready: !claimed && (units >= r.required_units || (pr?.progress ?? 0) >= 1),
        };
      })
      .sort((a, b) => a.required - b.required);
  }

  /**
   * Finished and missed drops, newest first: finished ones still on Kick, plus ones
   * that ended (or that Kick took down) before every reward was claimed, which only
   * the archive still knows about.
   */
  pastDrops(campaigns, settings, now) {
    const out = [];
    const shape = (c, rewards, units, entry, status) => {
      const tracked = rewards.filter((r) => r.tracked);
      const ends = new Date(c.ends_at ?? c.endsAt).getTime();
      const goneAt = entry?.goneAt ?? null;
      const claimedTimes = tracked.map((r) => entry?.claimedAt?.[r.id]).filter(Boolean);
      const cat = c.category ?? {};
      return {
        id: c.id,
        name: c.name,
        status,
        at: status === 'completed' ? (claimedTimes.length ? Math.max(...claimedTimes) : null) : Math.min(ends, goneAt ?? Infinity),
        categoryId: cat.id ?? c.categoryId,
        category: cat.name ?? null,
        image: this.img(cat.image_url || cat.banner_image_url || null),
        org: c.organization?.name ?? c.org ?? null,
        startsAt: c.starts_at ?? c.startsAt,
        endsAt: c.ends_at ?? c.endsAt,
        units,
        targetUnits: Math.max(0, ...tracked.map((r) => r.required)),
        rewards,
        claimed: tracked.filter((r) => r.claimed).length,
        total: tracked.length,
        // Kick took it down before its end date.
        removed: !!goneAt && goneAt < ends,
        onKick: !goneAt,
      };
    };
    const current = new Set();
    for (const c of campaigns) {
      current.add(c.id);
      if (!c.complete) continue;
      const raw = this.rawCampaigns.find((x) => x.id === c.id) ?? {};
      out.push(shape({ ...raw, ...c, category: raw.category }, c.rewards, c.units, this.archive?.get(c.id), 'completed'));
    }
    for (const entry of this.archive?.entries() ?? []) {
      const c = entry.raw;
      if (current.has(c.id) || !c.category?.id || !this.archive.involved(entry)) continue;
      const ended = new Date(c.ends_at).getTime() <= now || !!entry.goneAt;
      if (!ended) continue; // not started yet, or game drops only
      const rewards = this.modelRewards(c, entry.progress, settings).map((r) => ({ ...r, ready: false }));
      const tracked = rewards.filter((r) => r.tracked);
      if (entry.fromHistory) {
        // Rebuilt from history: only what was claimed is known.
        out.push({ ...shape(c, rewards, entry.progress?.units ?? 0, entry, entry.complete ? 'completed' : 'missed'), partial: true, removed: false, at: entry.lastSeen });
        continue;
      }
      if (!tracked.length) continue;
      out.push(shape(c, rewards, entry.progress?.units ?? 0, entry, tracked.every((r) => r.claimed) ? 'completed' : 'missed'));
    }
    return out.sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, 150);
  }

  /** One drop's details for the History view: live from Kick, else from the archive. */
  dropInfo(id) {
    const c = this.model.campaigns.find((x) => x.id === id);
    if (c) {
      const cat = this.model.categories.find((k) => k.id === c.categoryId);
      const tracked = c.rewards.filter((r) => r.tracked);
      return { id, name: c.name, status: c.complete ? 'completed' : 'live', category: cat?.name ?? null, categoryId: c.categoryId, image: cat?.image ?? null, org: c.org, endsAt: c.endsAt, units: c.units, targetUnits: c.targetUnits || Math.max(0, ...tracked.map((r) => r.required)), rewards: c.rewards, claimed: tracked.filter((r) => r.claimed).length, total: tracked.length, onKick: true, removed: false };
    }
    return (this.model.past ?? []).find((p) => p.id === id) ?? null;
  }

  /**
   * Follows or unfollows a channel on Kick. Followed channels are picked first, so the
   * stream lists re-sort straight away.
   */
  async setFollow(slug, on) {
    const key = String(slug).toLowerCase();
    if (on) await this.api.follow(key);
    else await this.api.unfollow(key);
    if (on) this.followed.add(key);
    else this.followed.delete(key);
    if (this.current?.slug.toLowerCase() === key) this.current.followed = on;
    const name = this.current?.slug.toLowerCase() === key ? this.current.username : slug;
    this.addLog('info', `${on ? 'Followed' : 'Unfollowed'} ${name}`);
    this.record(on ? 'follow' : 'unfollow', { slug: key, channel: name, text: `${on ? 'Followed' : 'Unfollowed'} ${name} on Kick` });
    this.buildModel();
    this.saveCache();
    this.changed();
    return { following: on };
  }

  /** History for drops that just ended (or Kick took down) and ones Kick brought back. */
  recordArchiveChanges({ ended = [], back = [] } = {}) {
    const settings = this.store.get();
    for (const id of ended) {
      const entry = this.archive.get(id);
      const c = entry?.raw;
      if (!c?.category) continue;
      const tracked = this.modelRewards(c, entry.progress, settings).filter((r) => r.tracked);
      if (!tracked.length) continue;
      const left = tracked.filter((r) => !r.claimed).length;
      const removed = entry.goneAt && entry.goneAt < new Date(c.ends_at).getTime();
      const text = `${c.name} ${removed ? 'was taken down by Kick' : 'ended'}${left ? `: missed ${left} of ${tracked.length} reward${tracked.length > 1 ? 's' : ''}` : ' with every reward claimed'}`;
      this.addLog(left ? 'warn' : 'info', text);
      this.record('campaign-ended', { campaignId: id, campaign: c.name, categoryId: c.category.id, category: c.category.name, missed: left, text });
    }
    for (const id of back) {
      const c = this.archive.get(id)?.raw;
      if (!c?.category) continue;
      const text = `${c.name} is back on Kick (now ends ${new Date(c.ends_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}) and returns to the queue`;
      this.addLog('info', text);
      this.record('campaign-back', { campaignId: id, campaign: c.name, categoryId: c.category.id, category: c.category.name, endsAt: c.ends_at, text });
    }
  }

  buildModel() {
    const settings = this.store.get();
    const now = Date.now();
    const progressById = new Map(this.progress.map((p) => [p.id, p]));

    const campaigns = this.rawCampaigns
      .filter((c) => c.status === 'active' || (new Date(c.starts_at) <= now && new Date(c.ends_at) > now))
      .filter((c) => c.category?.id)
      .map((c) => {
        const p = progressById.get(c.id);
        const units = p?.progress_units ?? 0;
        const rewards = this.modelRewards(c, p, settings);
        const tracked = rewards.filter((r) => r.tracked);
        const open = tracked.filter((r) => !r.claimed);
        const targetUnits = Math.max(0, ...open.map((r) => r.required));
        const next = open.find((r) => units < r.required) ?? null;
        return {
          id: c.id,
          name: c.name,
          org: c.organization?.name,
          orgLogo: this.img(c.organization?.logo_url),
          categoryId: c.category.id,
          endsAt: c.ends_at,
          startsAt: c.starts_at,
          channelIds: c.channels.map((ch) => ch.id),
          channels: c.channels.map((ch) => ({ id: ch.id, slug: ch.slug, username: ch.user?.username, avatar: ch.user?.profile_picture })),
          units,
          rewards,
          hasTracked: tracked.length > 0,
          complete: tracked.length > 0 && open.length === 0,
          needsWatching: open.some((r) => units < r.required),
          targetUnits,
          remainingUnits: Math.max(0, targetUnits - units),
          next: next && { id: next.id, name: next.name, required: next.required, remaining: next.required - units },
        };
      })
      .filter((c) => c.hasTracked);

    const byCategory = new Map();
    for (const raw of this.rawCampaigns) {
      if (raw.category?.id && !byCategory.has(raw.category.id)) byCategory.set(raw.category.id, raw.category);
    }

    const groups = new Map();
    for (const c of campaigns) {
      if (!groups.has(c.categoryId)) {
        const cat = byCategory.get(c.categoryId);
        groups.set(c.categoryId, {
          id: c.categoryId,
          name: cat.name,
          slug: cat.slug,
          image: this.img(cat.image_url || cat.banner_image_url || null),
          campaigns: [],
        });
      }
      groups.get(c.categoryId).campaigns.push(c);
    }

    const order = settings.categoryOrder;
    const disabled = new Set(settings.disabledCategories);
    const categories = [...groups.values()].map((cat) => {
      const active = cat.campaigns.filter((c) => c.needsWatching);
      const streams = this.candidatesFor(cat, active);
      const urgent = settings.prioritizeExpiring !== false ? this.urgency(active, now) : null;
      // Can the next reward of any open campaign still be earned before it ends?
      const feasible = active.some((c) => c.next && c.next.remaining * MIN < new Date(c.endsAt).getTime() - now);
      return {
        urgent,
        feasible,
        ...cat,
        enabled: !disabled.has(cat.id),
        complete: cat.campaigns.every((c) => c.complete),
        needsWatching: active.length > 0,
        soonestEnd: Math.min(...(active.length ? active : cat.campaigns).map((c) => new Date(c.endsAt).getTime())),
        remainingUnits: active.reduce((sum, c) => sum + c.remainingUnits, 0),
        streams,
        streamCount: streams.length,
        streamsLoaded: this.streams.has(cat.id),
      };
    });

    categories.sort((a, b) => {
      // Finished categories always sink to the bottom, whatever the saved order.
      if (a.complete !== b.complete) return a.complete ? 1 : -1;
      // Drops about to expire jump the queue, soonest deadline first.
      const ua = !!(a.urgent && a.enabled);
      const ub = !!(b.urgent && b.enabled);
      if (ua !== ub) return ua ? -1 : 1;
      if (ua && ub) return a.urgent.slack - b.urgent.slack;
      if (settings.queueMode === 'smart') {
        // Smart order: what's still worth watching, soonest-expiring first.
        if (a.needsWatching !== b.needsWatching) return a.needsWatching ? -1 : 1;
        if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
        // Drops with a live stream right now come before ones waiting for a stream.
        const la = a.streams.some((s) => !s.blocked);
        const lb = b.streams.some((s) => !s.blocked);
        if (a.streamsLoaded && b.streamsLoaded && la !== lb) return la ? -1 : 1;
        return a.soonestEnd - b.soonestEnd || a.remainingUnits - b.remainingUnits;
      }
      const ia = order.indexOf(a.id);
      const ib = order.indexOf(b.id);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib);
      if (a.needsWatching !== b.needsWatching) return a.needsWatching ? -1 : 1;
      return a.soonestEnd - b.soonestEnd;
    });

    this.model = { categories, campaigns, past: this.pastDrops(campaigns, settings, now) };
    this.recordMilestones();
    this.recordUrgency();
  }

  /** Records each category the first time it's moved up for its deadline. */
  recordUrgency() {
    this.urgentSeen ??= new Set();
    for (const cat of this.model.categories) {
      if (!cat.urgent || !cat.enabled || this.urgentSeen.has(cat.id)) continue;
      this.urgentSeen.add(cat.id);
      const hours = Math.max(1, Math.round(cat.urgent.msLeft / 3600_000));
      const text = `${cat.urgent.campaign} ends in ~${hours}h with ${cat.urgent.remaining} min to go: moved to the top of the queue`;
      this.addLog('alert', text);
      this.record('priority', { ...this.ctx(cat.urgent.campaignId), text });
    }
  }

  /**
   * The real emote behind a reward, when it's in your emote list (once claimed):
   * matched by name, e.g. "Hype Beast Emote" → HypeBeast. Returns its full-size
   * (animated, if it is) image, or null.
   */
  emotePreview(rewardName) {
    if (!this.emotes?.length) return null;
    const norm = (s) => String(s).toLowerCase().replace(/\b(emote|emoji|badge|chat)\b/g, '').replace(/[^a-z0-9]/g, '');
    const want = norm(rewardName);
    if (want.length < 3) return null;
    const exact = this.emotes.find((e) => norm(e.name) === want);
    const loose = exact ?? this.emotes.find((e) => {
      const n = norm(e.name);
      return n.length >= 4 && (want.includes(n) || n.includes(want));
    });
    if (!loose) return null;
    return { url: loose.url ?? `https://files.kick.com/emotes/${loose.id}/fullsize`, name: loose.name, animated: !!loose.animated };
  }

  /** Unlocked rewards and completed campaigns / categories, recorded once each. */
  recordMilestones() {
    const { campaigns, categories } = this.model;
    const ready = campaigns.flatMap((c) => c.rewards.filter((r) => r.tracked && (r.ready || r.claimed)).map((r) => [c, r]));
    const done = [...campaigns.filter((c) => c.complete).map((c) => `c:${c.id}`), ...categories.filter((c) => c.complete).map((c) => `k:${c.id}`)];
    if (!this.progress.length && !this.rawCampaigns.length) return;
    if (this.seenReady === null) {
      // First load: what's already done isn't news.
      this.seenReady = new Set(ready.map(([, r]) => r.id));
      this.seenComplete = new Set(done);
      return;
    }
    for (const [c, r] of ready) {
      if (this.seenReady.has(r.id)) continue;
      this.seenReady.add(r.id);
      this.record('unlock', { ...this.ctx(c.id), rewardId: r.id, reward: r.name, rewardImage: r.image, required: r.required, units: c.units, text: `${r.name} unlocked at ${r.required} min` });
    }
    for (const key of done) {
      if (this.seenComplete.has(key)) continue;
      this.seenComplete.add(key);
      const id = key.slice(2);
      if (key.startsWith('c:')) {
        const c = campaigns.find((x) => x.id === id);
        this.record('campaign-complete', { ...this.ctx(c.id), text: `Every emote and badge in ${c.name} collected` });
      } else {
        const cat = categories.find((x) => String(x.id) === id);
        this.record('category-complete', { categoryId: cat.id, category: cat.name, text: `${cat.name} complete, moving on` });
      }
    }
  }

  /**
   * A category is urgent when one of its campaigns would run out of time where it
   * sits in the queue (less than 1.5× its remaining watch time plus an hour left),
   * but its next reward can still be earned before it ends.
   */
  urgency(activeCampaigns, now) {
    let best = null;
    for (const c of activeCampaigns) {
      const msLeft = new Date(c.endsAt).getTime() - now;
      if (msLeft <= 0 || !c.next) continue;
      const tight = msLeft < (c.remainingUnits * 1.5 + 60) * MIN;
      const feasible = c.next.remaining * MIN < msLeft;
      // Slack: time to spare after watching what's left. Least slack goes first.
      const slack = msLeft - c.remainingUnits * MIN;
      if (tight && feasible && (!best || slack < best.slack)) {
        best = { campaignId: c.id, campaign: c.name, endsAt: now + msLeft, msLeft, slack, remaining: c.remainingUnits, nextRemaining: c.next.remaining };
      }
    }
    return best;
  }

  candidatesFor(cat, activeCampaigns) {
    const entry = this.streams.get(cat.id);
    if (!entry || !activeCampaigns.length) return [];
    const now = Date.now();
    const out = [];
    for (const ls of entry.list) {
      const covers = activeCampaigns
        .filter((c) => !c.channelIds.length || c.channelIds.includes(ls.channel.id))
        .map((c) => c.id);
      if (!covers.length) continue;
      const slug = ls.channel.slug;
      out.push({
        slug,
        channelId: ls.channel.id,
        username: ls.channel.username,
        avatar: ls.channel.profile_pic,
        title: ls.title,
        viewers: ls.viewer_count,
        thumbnail: ls.thumbnail?.src,
        startedAt: ls.start_time,
        language: ls.language,
        mature: ls.is_mature,
        categoryId: cat.id,
        followed: this.followed.has(slug.toLowerCase()),
        covers,
        blocked: (this.blacklist.get(slug) ?? 0) > now,
      });
    }
    return out.sort(
      (a, b) =>
        Number(b.followed) - Number(a.followed) ||
        b.covers.length - a.covers.length ||
        Number(a.blocked) - Number(b.blocked) ||
        b.viewers - a.viewers,
    );
  }

  async refreshStreams({ force }) {
    const now = Date.now();
    const disabled = new Set(this.store.get().disabledCategories);
    for (const cat of this.model.categories) {
      if (!cat.needsWatching || disabled.has(cat.id)) continue;
      const cached = this.streams.get(cat.id);
      // Categories with nothing live are re-checked every refresh, so a comeback is noticed quickly.
      const ttl = cached && cached.list.length === 0 ? 0 : (this.store.get().streamsMinutes ?? 3) * MIN;
      if (!force && cached && now - cached.at < ttl) continue;
      const active = cat.campaigns.filter((c) => c.needsWatching);
      const openWorld = active.some((c) => !c.channelIds.length);
      const wanted = new Set(active.flatMap((c) => c.channelIds));
      try {
        const list = await this.api.livestreams(cat.id, {
          maxPages: openWorld ? 1 : 5,
          stopWhen: (found) => [...wanted].every((id) => found.some((ls) => ls.channel.id === id)),
        });
        this.streams.set(cat.id, { at: now, list });
      } catch (err) {
        this.addLog('warn', `Could not list ${cat.name} streams: ${err.message}`);
      }
    }
  }

  // ------------------------------------------------------------------ claiming

  /**
   * Claims every unlocked emote/badge, then re-reads progress from Kick and only
   * counts a claim once Kick shows the reward as claimed.
   */
  async claimReady() {
    const now = Date.now();
    const sent = [];
    for (const c of this.model.campaigns) {
      for (const r of c.rewards) {
        if (!r.ready || !r.tracked) continue;
        if ((this.claimBackoff.get(r.id) ?? 0) > now) continue;
        try {
          await this.api.claim(c.id, r.id);
          sent.push([c, r]);
        } catch (err) {
          this.claimBackoff.set(r.id, now + 10 * MIN);
          this.addLog('warn', `Claim failed for ${r.name}: ${err.message}`);
          this.record('claim-failed', { ...this.ctx(c.id), rewardId: r.id, reward: r.name, rewardImage: r.image, text: `Kick refused the claim (${err.message}), retrying in 10 min` });
        }
      }
    }
    if (!sent.length) return;
    await this.confirmClaims(sent);
  }

  /** Re-reads progress and settles each sent claim as confirmed or not. */
  async confirmClaims(sent) {
    this.progress = await this.api.progress();
    const byId = new Map(this.progress.map((p) => [p.id, p]));
    for (const [c, r] of sent) {
      const confirmed = byId.get(c.id)?.rewards?.find((x) => x.id === r.id)?.claimed;
      if (confirmed) {
        this.claimBackoff.delete(r.id);
        this.stats.claims += 1;
        this.pushTimeline({ t: Date.now(), type: 'claim', name: r.name });
        this.addLog('claim', `Claimed ${r.name} (${c.name}), confirmed by Kick`);
        this.record('claim', { ...this.ctx(c.id), rewardId: r.id, reward: r.name, rewardImage: r.image, required: r.required, confirmed: true, text: `Claimed ${r.name} (confirmed by Kick)` });
        this.notify?.('Drop claimed', `${r.name} · ${c.name}`, r.image);
      } else {
        this.claimBackoff.set(r.id, Date.now() + 2 * MIN);
        this.addLog('warn', `Kick hasn't confirmed the claim for ${r.name} yet, retrying in 2 min`);
        this.record('claim-failed', { ...this.ctx(c.id), rewardId: r.id, reward: r.name, rewardImage: r.image, text: `Claim not confirmed by Kick yet, retrying in 2 min` });
      }
    }
    this.buildModel();
  }

  async claimOne(campaignId, rewardId) {
    this.claimBackoff.delete(rewardId);
    const c = this.model.campaigns.find((x) => x.id === campaignId);
    const r = c?.rewards.find((x) => x.id === rewardId);
    await this.api.claim(campaignId, rewardId);
    if (c && r) await this.confirmClaims([[c, r]]);
    this.changed();
  }


  // ------------------------------------------------------------------ decisions

  targetCategories() {
    return this.model.categories.filter((c) => c.enabled && c.needsWatching);
  }

  firstWatchableCategory() {
    return this.targetCategories().find((c) => c.streams.some((s) => !s.blocked));
  }

  async decide() {
    const now = Date.now();
    const settings = this.store.get();
    const cur = this.current;

    if (cur) {
      const reason = await this.checkCurrent(cur, now, settings);
      if (!reason) return;
      const quietMin = Math.round((now - cur.lastProgressAt) / MIN);
      if (reason.kind === 'stall') this.record('stall', { ...this.streamCtx(cur), minutes: quietMin, text: `${reason.text} on ${cur.username}`, action: reason.reload ? 'reload' : 'switch' });
      if (reason.kind === 'offline') this.record('offline', { ...this.streamCtx(cur), text: `${cur.username}: ${reason.text}` });
      if (reason.kind === 'category' || reason.kind === 'ineligible') {
        this.record('decision', { ...this.streamCtx(cur), text: `Left ${cur.username}: ${reason.text.toLowerCase()}; skipping it for ${reason.block / MIN} min` });
      }
      if (reason.kind === 'priority') {
        // Only leave a working stream once a stream in the other category is confirmed eligible.
        const target = await this.firstEligible(reason.to);
        if (!target) {
          this.record('decision', { ...this.streamCtx(cur), categoryId: reason.to.id, category: reason.to.name, text: `Stayed on ${cur.username}: ${reason.to.name} came back, but none of its live streams count for the drop yet` });
          return;
        }
        this.record('decision', { ...this.streamCtx(cur), ...(reason.to.urgent ? this.ctx(reason.to.urgent.campaignId) : {}), text: `Switching to ${reason.to.name}: ${reason.text}` });
        this.addLog('switch', `${reason.text}, leaving ${cur.username}`);
        this.stopWatching(reason.text);
        this.recordPick(target.stream, reason.to, target.campaignIds, target.skipped, this.targetCategories());
        this.startWatching(target.stream, reason.to, target.campaignIds, false);
        return;
      }
      if (reason.reload) {
        this.stats.reloads += 1;
        cur.reloads += 1;
        cur.lastProgressAt = reason.resetTo ?? now;
        this.addLog('warn', `${reason.text}, reloading ${cur.username}`);
        this.record('reload', { ...this.streamCtx(cur), reason: reason.text, text: `Reloaded ${cur.username}: ${reason.text}` });
        this.watcher.reload();
        return;
      }
      this.addLog('switch', `${reason.text}, leaving ${cur.username}`);
      if (reason.block) this.blacklist.set(cur.slug, now + reason.block);
      this.stopWatching(reason.text);
      this.buildModel();
    }

    await this.pickStream();
  }

  /**
   * Kick credits only one stream per account. If our player keeps sending watch
   * events and none of them are credited, another stream is taking the credit.
   */
  checkCreditConflict(now) {
    const settings = this.store.get();
    if (!settings.alertOnStall || !this.current) return;
    if (this.eventsSinceCredit < CONFLICT_EVENTS) return;
    if (this.lastAlertAt && now - this.lastAlertAt < CONFLICT_REPEAT_MS) return;
    this.lastAlertAt = now;
    const minutes = Math.round((now - (this.lastCreditAt ?? now)) / MIN);
    this.addLog('alert', `${this.eventsSinceCredit} watch events with no credit: another Kick stream on your account is taking it`);
    this.emit('stall-alert', { minutes, events: this.eventsSinceCredit });
    this.record('conflict', { ...this.streamCtx(), minutes, events: this.eventsSinceCredit, text: `${this.eventsSinceCredit} watch events with no credit: another Kick stream on your account is taking it` });
  }

  async checkCurrent(cur, now, settings) {
    let info = null;
    try {
      info = await this.api.channelInfo(cur.slug);
    } catch (err) {
      if (err.status === 404) return { kind: 'offline', text: 'Channel is gone (deleted or banned)', block: 6 * 60 * MIN };
      // Network trouble: keep watching rather than give up on a good stream.
      this.addLog('warn', `Could not check ${cur.username}: ${err.message}`);
    }
    if (info?.is_banned) return { kind: 'offline', text: 'Channel is banned', block: 6 * 60 * MIN };
    if (info) {
      const live = info.livestream?.is_live;
      if (!live) return { kind: 'offline', text: 'Stream went offline' };
      const categories = info.livestream.categories?.map((c) => c.id) ?? [];
      cur.title = info.livestream.session_title ?? cur.title;
      cur.viewers = info.livestream.viewer_count ?? cur.viewers;
      if (categories.length && !categories.includes(cur.categoryId)) {
        return { kind: 'category', text: 'Streamer changed category', block: 15 * MIN };
      }
    }

    // Every few minutes, ask Kick again whether this stream still counts (a channel can
    // be dropped from a campaign mid-stream).
    if (now - (cur.eligibleCheckedAt ?? cur.startedWatchingAt) > ELIGIBLE_RECHECK_MS) {
      cur.eligibleCheckedAt = now;
      const still = await this.verifyEligible({ channelId: cur.channelId, covers: cur.campaignIds }, { id: cur.categoryId });
      if (!still.length) return { kind: 'ineligible', text: 'Stream no longer counts for the drop', block: 20 * MIN };
    }

    const campaigns = this.model.campaigns.filter((c) => cur.campaignIds.includes(c.id));
    cur.campaignIds = campaigns.filter((c) => c.needsWatching).map((c) => c.id);
    if (!cur.campaignIds.length) return { text: 'Drops for this stream are done' };

    const cat = this.model.categories.find((c) => c.id === cur.categoryId);
    if (cat && !cat.enabled) return { text: `${cat.name} was disabled` };

    if (!cur.manual) {
      const first = this.firstWatchableCategory();
      const order = this.model.categories.map((c) => c.id);
      const curCat = this.model.categories.find((c) => c.id === cur.categoryId);
      // Smart order doesn't hop for a small difference: the other drop must end at least 30 min sooner.
      const smartHop = settings.queueMode !== 'smart' || first?.urgent || !curCat || first.soonestEnd < curCat.soonestEnd - 30 * MIN;
      if (first && first.id !== cur.categoryId && order.indexOf(first.id) < order.indexOf(cur.categoryId) && smartHop) {
        const why = first.urgent
          ? `${first.urgent.campaign} ends in ${fmtSpan(first.urgent.msLeft)} with ${first.urgent.remaining} min to go (${fmtSpan(Math.max(0, first.urgent.slack))} to spare)`
          : settings.queueMode === 'smart'
            ? `${first.name} ends sooner (${fmtSpan(first.soonestEnd - now)}`
            : `${first.name} is higher in your queue`;
        const curEnd = curCat ? Math.min(...curCat.campaigns.filter((c) => c.needsWatching).map((c) => new Date(c.endsAt).getTime())) : null;
        const versus = settings.queueMode === 'smart' && !first.urgent ? ` vs ${curCat?.name ?? 'now'} ${curEnd ? fmtSpan(curEnd - now) : ''})` : curEnd ? ` vs ${curCat.name} (${fmtSpan(curEnd - now)} left)` : '';
        return { kind: 'priority', text: `${why}${versus}`, to: first };
      }
    }

    // Stalled: reload once, then move to another stream if there is one.
    const stallMs = settings.stallMinutes * MIN;
    if (now - cur.lastProgressAt > stallMs) {
      const text = `No progress for ${Math.round((now - cur.lastProgressAt) / MIN)} min`;
      const alternatives = (cat?.streams ?? []).filter((s) => !s.blocked && s.slug !== cur.slug);
      if (cur.stallReloaded && alternatives.length && !cur.manual) {
        return { kind: 'stall', text, block: 30 * MIN };
      }
      cur.stallReloaded = true;
      return { kind: 'stall', text, reload: true, resetTo: now - stallMs / 2 };
    }

    const ws = this.watcher.status;
    const stuckSince = Math.max(ws.lastAdvanceAt ?? 0, cur.lastReloadAt ?? 0);
    if (ws.loadedAt && now - ws.loadedAt > 2 * MIN && now - stuckSince > PLAYER_STUCK_MS) {
      cur.lastReloadAt = now;
      cur.stuckReloads = (cur.stuckReloads ?? 0) + 1;
      const alternatives = (cat?.streams ?? []).some((s) => !s.blocked && s.slug !== cur.slug);
      if (cur.stuckReloads > MAX_STUCK_RELOADS && alternatives && !cur.manual) {
        return { text: 'Player still not playing after reloads', block: 30 * MIN };
      }
      return { text: 'Player is not playing', reload: true, resetTo: cur.lastProgressAt };
    }
    if (ws.lastAdvanceAt && now - ws.lastAdvanceAt < MIN) cur.stuckReloads = 0;
    return null;
  }

  async pickStream() {
    const targets = this.targetCategories();
    if (!targets.length) {
      this.lastCreditAt = null;
      this.eventsSinceCredit = 0;
      const anything = this.model.campaigns.length;
      this.setStatus('done', anything ? 'Every emote and badge drop is claimed' : 'No active emote or badge drops');
      return;
    }

    for (const cat of targets) {
      const candidates = cat.streams.filter((s) => !s.blocked).slice(0, 4);
      const skipped = [];
      for (const stream of candidates) {
        const ok = await this.verifyEligible(stream, cat);
        if (ok.length) {
          this.recordPick(stream, cat, ok, skipped, targets);
          this.startWatching(stream, cat, ok, false);
          return;
        }
        skipped.push(stream.username);
        this.blacklist.set(stream.slug, Date.now() + 20 * MIN);
        this.addLog('warn', `${stream.username} is not eligible for drops right now, skipping`);
        this.record('not-eligible', { slug: stream.slug, channel: stream.username, avatar: stream.avatar, categoryId: cat.id, category: cat.name, text: `${stream.username} isn't eligible for ${cat.name} drops right now` });
      }
    }
    this.lastCreditAt = null;
    this.eventsSinceCredit = 0;
    this.setStatus('waiting', 'No live streams for the remaining drops, checking again soon');
  }

  /** The first stream in a category Kick confirms counts for its drops (marks the ones that don't). */
  async firstEligible(cat) {
    const skipped = [];
    for (const stream of cat.streams.filter((s) => !s.blocked).slice(0, 4)) {
      const campaignIds = await this.verifyEligible(stream, cat);
      if (campaignIds.length) return { stream, campaignIds, skipped };
      this.blacklist.set(stream.slug, Date.now() + 20 * MIN);
      skipped.push(stream.username);
    }
    this.buildModel();
    return null;
  }

  /** Why this stream (and this category) was chosen, for the history. */
  recordPick(stream, cat, campaignIds, skipped, targets) {
    const reasons = [];
    if (cat.urgent) reasons.push(`${cat.urgent.campaign} ends in ${fmtSpan(cat.urgent.msLeft)} and needs ${cat.urgent.remaining} min`);
    else if (targets[0]?.id !== cat.id) reasons.push(`${targets.filter((c) => c.id !== cat.id && c.streams.every((s) => s.blocked)).map((c) => c.name).join(', ') || 'higher categories'} had no usable stream`);
    else if (this.store.get().queueMode === 'smart') reasons.push(`it ends soonest (${fmtSpan(cat.soonestEnd - Date.now())} left)`);
    else reasons.push(`top of your queue`);
    if (stream.followed) reasons.push('a channel you follow');
    if (campaignIds.length > 1) reasons.push(`counts for ${campaignIds.length} drops at once`);
    reasons.push(`${stream.viewers} viewers`);
    const alternatives = cat.streams.filter((s) => !s.blocked && s.slug !== stream.slug).length;
    const text = `Picked ${stream.username} for ${cat.name}: ${reasons.join(', ')}${skipped.length ? `; skipped ${skipped.join(', ')} (not eligible)` : ''}${alternatives ? ` · ${alternatives} other live option${alternatives > 1 ? 's' : ''}` : ''}`;
    this.addLog('info', text);
    this.record('decision', { slug: stream.slug, channel: stream.username, avatar: stream.avatar, categoryId: cat.id, category: cat.name, campaignIds, ...(campaignIds[0] ? { campaignId: campaignIds[0], campaign: this.ctx(campaignIds[0]).campaign } : {}), text });
  }

  async verifyEligible(stream, cat) {
    try {
      const live = await this.api.campaignsForLivestream(stream.channelId, cat.id);
      const ids = new Set(live.map((c) => c.id));
      return stream.covers.filter((id) => ids.has(id));
    } catch {
      return stream.covers;
    }
  }

  startWatching(stream, cat, campaignIds, manual) {
    const now = Date.now();
    this.current = {
      ...stream,
      categoryId: cat.id,
      categoryName: cat.name,
      campaignIds,
      campaignSince: Object.fromEntries(campaignIds.map((id) => [id, now])),
      startedWatchingAt: now,
      lastProgressAt: now,
      lastReloadAt: null,
      reloads: 0,
      credited: 0,
      manual,
      session: `${now.toString(36)}-${stream.slug}`,
    };
    this.record('watch-start', {
      ...this.streamCtx(),
      campaigns: campaignIds.map((id) => this.ctx(id).campaign),
      manual,
      viewers: stream.viewers,
      text: `Watching ${stream.username} for ${cat.name}${manual ? ' (picked by you)' : ''}`,
    });
    this.stats.switches += 1;
    this.stats.watchTickAt = now;
    this.lastCreditAt ??= now;
    this.pushTimeline({ t: now, type: 'switch', name: stream.username });
    this.addLog('switch', `Watching ${stream.username} for ${cat.name}${manual ? ' (manual)' : ''}`);
    this.setStatus('farming', `Watching ${stream.username}`);
    this.watcher.watch(stream.slug);
    this.changed();
  }

  stopWatching(reason = 'Stopped') {
    clearTimeout(this.crashTimer);
    const cur = this.current;
    if (cur) {
      const minutes = Math.round((Date.now() - cur.startedWatchingAt) / MIN);
      this.record('watch-end', { ...this.streamCtx(cur), reason, minutes, credited: cur.credited, text: `Left ${cur.username} after ${minutes} min (+${cur.credited} credited): ${reason}` });
    }
    this.accumulateWatchTime();
    this.stats.watchTickAt = null;
    this.current = null;
    this.watcher.stop();
  }

  async watchManual(slug, categoryId) {
    const cat = this.model.categories.find((c) => c.id === categoryId);
    const stream = cat?.streams.find((s) => s.slug === slug);
    if (!cat || !stream) throw new Error('Stream is no longer available');
    this.stopWatching(`Switched to ${stream.username} by you`);
    this.blacklist.delete(slug);
    this.startWatching(stream, cat, stream.covers, true);
  }

  async skip() {
    if (!this.current) return this.tick();
    this.addLog('switch', `Skipped ${this.current.username}`);
    this.blacklist.set(this.current.slug, Date.now() + 30 * MIN);
    this.stopWatching('Skipped by you');
    this.buildModel();
    await this.pickStream();
    this.changed();
  }

  /** Player page crashed, froze or failed to load: retry with backoff, then give up on the stream. */
  handleCrash(reason) {
    const cur = this.current;
    if (!cur) return;
    const now = Date.now();
    cur.crashes = (cur.crashes ?? []).filter((t) => now - t < 10 * MIN).concat(now);
    if (cur.crashes.length >= MAX_CRASHES) {
      this.addLog('switch', `${cur.username} failed ${cur.crashes.length} times (${reason}), switching stream`);
      this.blacklist.set(cur.slug, now + 30 * MIN);
      this.stopWatching(`Kept failing (${reason})`);
      this.buildModel();
      this.pickStream().finally(() => this.changed());
      return;
    }
    this.record('crash', { ...this.streamCtx(cur), reason, text: `Player problem on ${cur.username}: ${reason}` });
    const delay = 5000 * cur.crashes.length;
    this.addLog('warn', `Player problem on ${cur.username} (${reason}), retrying in ${delay / 1000}s`);
    clearTimeout(this.crashTimer);
    this.crashTimer = setTimeout(() => {
      if (this.current?.slug === cur.slug) this.watcher.reload();
    }, delay);
  }

  /** After the computer sleeps the page and socket are usually dead. */
  handleResume() {
    this.addLog('info', 'Computer woke up, refreshing');
    this.record('wake', { text: 'Computer woke from sleep, reloaded the stream' });
    if (this.current) this.watcher.reload();
    this.tick({ force: true });
  }

  reloadPlayer() {
    if (!this.current) return;
    this.stats.reloads += 1;
    this.addLog('info', `Reloading ${this.current.username}`);
    this.watcher.reload();
  }

  // ------------------------------------------------------------------ metrics

  accumulateWatchTime() {
    const now = Date.now();
    if (this.current && this.stats.watchTickAt) {
      this.stats.watchMs += now - this.stats.watchTickAt;
      this.stats.watchTickAt = now;
    }
  }

  /** Units per minute observed for a campaign while it was being watched (last 30 min). */
  rateFor(campaignId) {
    const cur = this.current;
    const since = cur?.campaignSince?.[campaignId];
    if (!since) return { rate: NOMINAL_RATE, observed: false };
    const now = Date.now();
    const windowStart = Math.max(since, now - 30 * MIN);
    const minutes = (now - windowStart) / MIN;
    if (minutes < 8) return { rate: NOMINAL_RATE, observed: false };
    const earned = this.timeline
      .filter((e) => e.type === 'credit' && e.campaignId === campaignId && e.t >= windowStart)
      .reduce((sum, e) => sum + e.delta, 0);
    return { rate: earned / minutes, observed: true };
  }

  forecast() {
    const out = {};
    for (const c of this.model.campaigns) {
      if (!c.needsWatching) continue;
      const { rate, observed } = this.rateFor(c.id);
      const eff = Math.max(rate, 0.0001);
      out[c.id] = {
        rate,
        observed,
        nextMinutes: c.next ? c.next.remaining / eff : 0,
        doneMinutes: c.remainingUnits / eff,
        stalled: observed && rate < 0.05,
      };
    }
    return out;
  }

  pushTimeline(entry) {
    this.timeline.push(entry);
    const cutoff = Date.now() - HISTORY_MS;
    if (this.timeline.length > 2000 || this.timeline[0].t < cutoff) {
      this.timeline = this.timeline.filter((e) => e.t >= cutoff).slice(-2000);
    }
  }

  addLog(level, text) {
    this.log.push({ t: Date.now(), level, text });
    if (this.log.length > 300) this.log = this.log.slice(-300);
    this.changed();
  }

  setStatus(code, message) {
    this.status = { code, message };
  }

  changed() {
    if (this.changeTimer) return;
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null;
      this.emit('update');
    }, 200);
  }

  /** Tray icon state: ring colour, fraction and short text. */
  trayInfo() {
    const cur = this.current;
    const conflict = !!cur && this.eventsSinceCredit >= CONFLICT_EVENTS;
    let tone = this.paused ? 'paused' : conflict ? 'conflict' : ({ farming: 'farming', waiting: 'waiting', done: 'done', error: 'error' }[this.status.code] ?? 'idle');
    let fraction = 0;
    let title = '';
    let tooltip = `Pear Drops · ${this.paused ? 'Paused' : this.status.message}`;
    if (cur && !this.paused) {
      const forecast = this.forecast();
      const camps = this.model.campaigns
        .filter((c) => cur.campaignIds.includes(c.id))
        .sort((a, b) => (forecast[a.id]?.nextMinutes ?? 1e9) - (forecast[b.id]?.nextMinutes ?? 1e9));
      const primary = camps[0];
      if (primary) {
        fraction = primary.units / Math.max(1, primary.targetUnits);
        title = `${Math.floor(fraction * 100)}%`;
        const next = forecast[primary.id]?.nextMinutes;
        const eta = Number.isFinite(next) ? (next >= 60 ? `${Math.floor(next / 60)}h ${Math.round(next % 60)}m` : `${Math.max(1, Math.round(next))}m`) : null;
        tooltip = `Pear Drops · ${primary.name} ${title}${eta ? ` · next reward in ${eta}` : ''} · watching ${cur.username}`;
      }
    }
    if (conflict) tooltip = 'Pear Drops · Another Kick stream is taking your drop credit';
    return { tone, fraction, title: conflict ? '!' : title, tooltip };
  }

  snapshot() {
    this.accumulateWatchTime();
    const settings = this.store.get();
    const cur = this.current;
    const watchedCampaigns = new Set(cur?.campaignIds ?? []);
    return {
      status: this.paused ? { code: 'paused', message: 'Paused' } : this.status,
      paused: this.paused,
      ticking: this.ticking,
      nextTickAt: this.nextTickAt,
      stallMinutes: settings.stallMinutes,
      lastCreditAt: this.lastCreditAt,
      lastAlertAt: this.lastAlertAt,
      eventsSinceCredit: this.eventsSinceCredit,
      conflict: this.eventsSinceCredit >= CONFLICT_EVENTS,
      current: cur && {
        slug: cur.slug,
        username: cur.username,
        avatar: cur.avatar,
        title: cur.title,
        viewers: cur.viewers,
        thumbnail: cur.thumbnail,
        followed: cur.followed,
        categoryId: cur.categoryId,
        categoryName: cur.categoryName,
        campaignIds: cur.campaignIds,
        startedWatchingAt: cur.startedWatchingAt,
        lastProgressAt: cur.lastProgressAt,
        reloads: cur.reloads,
        manual: cur.manual,
      },
      player: this.watcher.status,
      categories: this.model.categories.map((cat) => ({
        ...cat,
        streams: cat.streams.slice(0, 60),
        campaigns: cat.campaigns.map((c) => ({ ...c, channelIds: undefined, watching: watchedCampaigns.has(c.id) })),
      })),
      past: this.model.past ?? [],
      forecast: this.forecast(),
      stats: { ...this.stats, followedCount: this.followed.size },
      samples: this.samples.slice(-360),
      timeline: this.timeline.filter((e) => e.t > Date.now() - 3 * 60 * MIN),
      log: this.log.slice(-150),
    };
  }
}

module.exports = { Farmer, rewardKind };
