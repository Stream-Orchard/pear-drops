// Kick's Daily Reward: watch any Kick stream for an hour (midnight to midnight UTC), then open a
// crate; a reel picks a collectible emote or badge by rarity, and a card you already own turns
// into level progress. Watching anywhere signed in counts: Pear Drops, Stream Multiview, kick.com.
//
// No Electron here. The requests come in as `kick` (kick-api.js's methods, or the demo's), so the
// login token stays in the hidden kick.com page, and tests use stand-ins.
const { EventEmitter } = require('events');

const MIN = 60_000;
const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
// Kick's own videos. A challenge's links come without an extension; Electron plays the WebM.
const MEDIA = 'https://static.kick.com/rewards/daily-rewards/';
const MEDIA_HOST = 'https://static.kick.com/';

// How often Kick is asked (it's behind Cloudflare, so as little as works):
const EARNING_MS = 2 * MIN; // while the hour is being earned and Pear Drops (or a connected app) is watching, as kick.com does
const IDLE_MS = 10 * MIN; // otherwise: someone may be watching elsewhere, or claim on kick.com
const CARDS_MS = 6 * 60 * MIN; // the card list, level and streak, besides after each claim
const RETRY_MS = 3 * MIN; // after Kick didn't answer
const OPENED_MS = 15_000; // the card opened: looks again unless it just did
const AUTO_BEFORE_MS = 15 * MIN; // "Before it resets": this long before midnight UTC
const REMIND_BEFORE_MS = 60 * MIN; // "ready" again, an hour before it resets, if still waiting
const CLAIM_MODES = ['self', 'before-reset', 'now'];

/** Kick wraps every reply in { data, message }. */
const unwrap = (body) => (body && typeof body === 'object' && !Array.isArray(body) && 'data' in body ? body.data : body);
const listOf = (body) => {
  const d = unwrap(body);
  return Array.isArray(d) ? d : Array.isArray(d?.challenges) ? d.challenges : [];
};
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const time = (iso) => {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? t : null;
};
/** The UTC day a time falls in, e.g. "2026-10-20". */
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

/** A video link Kick gave, with ".webm" added, or Kick's default. Only Kick's own media host. */
function mediaUrl(url, fallback) {
  const u = typeof url === 'string' && url.startsWith(MEDIA_HOST) ? url : fallback;
  return /\.[a-z0-9]{3,4}$/i.test(u) ? u : `${u}.webm`;
}

/** Each rarity's chance, from Kick's weights, in rarity order. */
function oddsOf(table) {
  const rows = (Array.isArray(table) ? table : []).filter((r) => RARITIES.includes(r?.rarity));
  const total = rows.reduce((s, r) => s + Math.max(0, num(r.weighting)), 0);
  if (!total) return [];
  return RARITIES.filter((id) => rows.some((r) => r.rarity === id)).map((id) => ({
    rarity: id,
    chance: rows.filter((r) => r.rarity === id).reduce((s, r) => s + Math.max(0, num(r.weighting)), 0) / total,
  }));
}

/** One challenge, in the app's words: earning, ready or claimed. */
function readChallenge(c) {
  if (!c || typeof c !== 'object' || c.id == null) return null;
  const threshold = Math.max(1, num(c.condition?.threshold, 60));
  const state = c.status === 'claimable' ? 'ready' : c.status === 'claimed' ? 'claimed' : 'earning';
  return {
    id: String(c.id),
    name: typeof c.name === 'string' ? c.name : '',
    recurrence: c.recurrence ?? 'daily',
    condition: c.condition?.type ?? 'watch_time_minutes',
    state,
    minutes: state === 'earning' ? Math.min(threshold, Math.max(0, Math.floor(num(c.condition?.progress)))) : threshold,
    threshold,
    startsAt: time(c.window?.starts_at),
    endsAt: time(c.window?.ends_at),
    featured: !!c.featured,
    revealType: c.reveal_type ?? null,
    odds: oddsOf(c.drop_table),
    media: { idle: mediaUrl(c.animations?.idle_url, `${MEDIA}idle`), unbox: mediaUrl(c.animations?.unbox_url, `${MEDIA}unbox`) },
    winner: c.winner ? cardOf(c.winner) : null,
    consolation: c.consolation ?? null,
  };
}

/**
 * The daily one and the rest (event crates, the Welcome Reward). Only the others Pear Drops can do
 * something about: one that's ready to claim, or one that fills by watching. The Welcome Reward
 * waits on Kick's own sign-up steps, a pop-up kick.com shows when it chooses, with no link to it.
 */
function readChallenges(body, oneOff = null) {
  const all = [...listOf(body), ...listOf(oneOff)].map(readChallenge).filter(Boolean);
  const unique = [...new Map(all.map((c) => [c.id, c])).values()];
  const daily = unique.find((c) => c.recurrence === 'daily' && c.condition === 'watch_time_minutes') ?? null;
  return { daily, extras: unique.filter((c) => c !== daily && (c.state === 'ready' || (c.state === 'earning' && c.condition === 'watch_time_minutes'))) };
}

// Kick's card pictures are https; the demo's are drawn as data images.
const isImage = (u) => typeof u === 'string' && (u.startsWith('https://') || u.startsWith('data:image/'));

/** A card as the pages show it: its picture says its name, so there's no name. */
function cardOf(c) {
  if (!c || typeof c !== 'object') return null;
  const image = [c.card_url, c.thumbnail_url, c.item_url, c.image_url].find(isImage) ?? null;
  return { id: c.id == null ? null : String(c.id), rarity: RARITIES.includes(c.rarity) ? c.rarity : 'common', type: c.type === 'badge' ? 'badge' : 'emote', image };
}

/** Kick's cards, counted: how many there are, and how many are yours, rarity by rarity. */
function collectionOf(body) {
  const cards = listOf(body).length ? listOf(body) : (unwrap(body)?.collectibles ?? []);
  const byRarity = Object.fromEntries(RARITIES.map((r) => [r, { owned: 0, total: 0 }]));
  for (const c of Array.isArray(cards) ? cards : []) {
    const r = byRarity[c?.rarity];
    if (!r) continue;
    r.total += 1;
    if (c.owned) r.owned += 1;
  }
  const rows = Object.values(byRarity);
  return { owned: rows.reduce((s, r) => s + r.owned, 0), total: rows.reduce((s, r) => s + r.total, 0), byRarity };
}

/**
 * The chance the next card is one you have: each rarity's chance times the share of it you own.
 * Kick only gives weights by rarity, so every card of a rarity counts as equally likely.
 */
function duplicateChance(odds, byRarity) {
  return (odds ?? []).reduce((s, { rarity, chance }) => {
    const r = byRarity?.[rarity];
    return r?.total ? s + chance * (r.owned / r.total) : s;
  }, 0);
}

/**
 * A claim's reply as the reveal plays it: Kick's reel, which tile is the winner, and whether it
 * was a duplicate (and the level progress it turned into). The reel's tiles come without a
 * rarity; the card list has it.
 */
function reelOf(reply, rarities = new Map()) {
  const r = unwrap(reply) ?? {};
  const winner = cardOf(r.winner);
  const items = (Array.isArray(r.roulette) ? r.roulette : [])
    .map((t) => ({ id: t?.id == null ? null : String(t.id), image: [t?.item_url, t?.card_url, t?.thumbnail_url].find(isImage) ?? null, rarity: rarities.get(String(t?.id)) ?? 'common' }))
    .filter((t) => t.image);
  let winnerIndex = winner?.id ? items.findIndex((t) => t.id === winner.id) : -1;
  if (winner?.image && winnerIndex < 0) {
    items.push({ id: winner.id, image: winner.image, rarity: winner.rarity });
    winnerIndex = items.length - 1;
  }
  if (winner && items[winnerIndex]) items[winnerIndex].rarity = winner.rarity;
  const consolation = r.consolation ?? null;
  const levelTo = num(consolation?.next_level_badge?.metadata?.level ?? consolation?.next_level_badge?.level, NaN);
  return {
    items: items.map(({ image, rarity }) => ({ image, rarity })),
    winnerIndex: Math.max(0, winnerIndex),
    winner,
    duplicate: !!consolation,
    xpMinutes: consolation ? num(consolation.watch_time_minutes, 0) : 0,
    levelTo: Number.isFinite(levelTo) ? levelTo : null,
    revealType: r.reveal_type ?? null,
  };
}

/** Level and progress towards the next one, as kick.com shows it: a share, no units. */
function levelOf(body) {
  const d = unwrap(body);
  if (!d || !Number.isFinite(Number(d.level))) return null;
  return {
    level: num(d.level),
    progress: Math.max(0, num(d.progress_xp)),
    toNext: Math.max(0, num(d.xp_to_next_level)),
    badge: [d.badge?.image_url, d.badge?.animated_image_url].find((u) => typeof u === 'string' && u.startsWith('https://')) ?? null,
  };
}

/** How the user chose to claim: by hand, before it resets, or right away. */
const claimMode = (settings) => (CLAIM_MODES.includes(settings?.dailyClaim) ? settings.dailyClaim : 'before-reset');

/**
 * When to look again, in ms from now: soon while the hour is being earned on this computer (and
 * right when it should be done), rarely otherwise, and at the reset.
 */
function nextCheckIn({ daily, watching, now, error = false }) {
  if (error) return RETRY_MS;
  if (!daily) return IDLE_MS;
  const reset = daily.endsAt ? Math.max(1000, daily.endsAt - now + 5000) : Infinity;
  let next = IDLE_MS;
  if (daily.state === 'earning' && watching) next = Math.min(EARNING_MS, Math.max(5000, (daily.threshold - daily.minutes) * MIN + 30_000));
  if (daily.state === 'claimed') next = reset;
  return Math.min(next, reset);
}

/** What the record in History says about a claim. */
function claimText(reel) {
  const kind = `${reel.winner?.rarity ? reel.winner.rarity[0].toUpperCase() + reel.winner.rarity.slice(1) : 'Common'} ${reel.winner?.type ?? 'emote'}`;
  if (!reel.duplicate) return { reward: kind, text: `${kind}, new to your collection` };
  const xp = reel.xpMinutes ? `, +${reel.xpMinutes} min watch time${reel.levelTo ? ` to Level ${reel.levelTo}` : ''}` : '';
  return { reward: kind, text: `${kind}, a duplicate${xp}` };
}

class DailyReward extends EventEmitter {
  /**
   * @param {object} o
   * @param {object} o.kick dailyChallenges(query), collectibles(), level(), streak(userId), claimDaily(id)
   * @param {{ load: () => object, save: (v: object) => void }} o.slot what's kept between launches
   * @param {() => object} o.settings the app's settings (dailyClaim)
   * @param {() => boolean} o.watching whether Pear Drops (or a connected app's Kick players, as this account) is watching a stream right now
   * @param {() => (string|number|null)} o.userId the signed-in Kick account's id
   * @param {{ add: (type: string, data: object) => void }} [o.history]
   * @param {boolean} [o.kickMedia] play Kick's videos (demo mode never goes to the network, so draws its own crate)
   * @param {() => number} [o.now]
   */
  constructor({ kick, slot, settings, watching, userId, history = null, kickMedia = true, now = () => Date.now(), timers = { set: setTimeout, clear: clearTimeout } }) {
    super();
    Object.assign(this, { kick, slot, settings, watching, userId, history, kickMedia, now, timers });
    this.saved = { ...(slot?.load?.() ?? {}) }; // { day, reel, by }: the last claim, for the card and Replay
    this.reset();
  }

  reset() {
    this.running = false;
    this.daily = null;
    this.extras = [];
    this.collection = null;
    this.level = null;
    this.streak = null;
    this.cardsAt = 0;
    this.checkedAt = 0; // when Kick was last asked
    this.rarities = new Map();
    this.error = false;
    this.claiming = false;
    this.reminded = null; // the day "an hour left" was said
    this.autoTried = null; // the day an automatic claim was tried
    this.timer && this.timers.clear(this.timer);
    this.timer = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.refresh({ full: true });
  }

  stop() {
    this.reset();
    this.emit('change');
  }

  /** Kick said the hour is done (its realtime GamificationWatchTimeGoalReached). */
  goalReached() {
    if (this.running) this.schedule(1500);
  }

  /** The card was opened: what it says now, unless that was just asked (or a claim is under way). */
  opened() {
    if (this.running && !this.claiming && this.now() - this.checkedAt >= OPENED_MS) this.refresh();
  }

  /** Watching started (here or in a connected app): while the hour is being earned, look more often from now on. */
  watchingStarted() {
    if (this.running && this.daily?.state === 'earning' && !this.claiming) this.schedule(5000);
  }

  async refresh({ full = false } = {}) {
    if (!this.running) return;
    const was = this.daily?.state ?? null;
    this.checkedAt = this.now();
    try {
      const wantCards = full || !this.collection || this.now() - this.cardsAt > CARDS_MS || (this.daily?.endsAt && this.now() >= this.daily.endsAt);
      const [challenges, oneOff] = await Promise.all([this.kick.dailyChallenges(), wantCards ? this.kick.dailyChallenges({ recurrence: 'one_off' }).catch(() => null) : null]);
      const read = readChallenges(challenges, oneOff);
      this.daily = read.daily;
      // Kick's plain list leaves out the one-off ones (the Welcome Reward): kept from the last time they were asked for.
      this.extras = oneOff ? read.extras : [...read.extras, ...this.extras.filter((e) => e.recurrence === 'one_off' && !read.extras.some((x) => x.id === e.id))];
      if (wantCards) await this.refreshCards();
      this.error = false;
    } catch (err) {
      if (err?.status === 401 || err?.status === 403) this.emit('auth-lost');
      this.error = true;
    }
    if (!this.running) return;
    const now = this.daily?.state ?? null;
    if (now === 'ready' && was === 'earning') this.emit('ready', this.snapshot());
    this.emit('change');
    this.afterRefresh();
  }

  async refreshCards() {
    const uid = this.userId?.();
    const [cards, level, streak] = await Promise.all([
      this.kick.collectibles().catch(() => null),
      this.kick.level().catch(() => null),
      uid != null ? this.kick.streak(uid).catch(() => null) : null,
    ]);
    if (cards) {
      this.collection = collectionOf(cards);
      const list = listOf(cards);
      this.rarities = new Map(list.filter((c) => c?.id != null).map((c) => [String(c.id), RARITIES.includes(c.rarity) ? c.rarity : 'common']));
    }
    if (level) this.level = levelOf(level) ?? this.level;
    if (streak) this.streak = num(unwrap(streak)?.length_days, this.streak ?? 0);
    this.cardsAt = this.now();
  }

  /** Claims on its own when the user chose so, reminds before the reset, then waits for the next check. */
  afterRefresh() {
    const d = this.daily;
    const now = this.now();
    if (d?.state === 'ready' && d.endsAt) {
      const day = dayOf(d.startsAt ?? now);
      const mode = claimMode(this.settings());
      const autoAt = mode === 'now' ? now : mode === 'before-reset' ? d.endsAt - AUTO_BEFORE_MS : Infinity;
      if (now >= autoAt && this.autoTried !== day) {
        this.autoTried = day;
        this.claim(d.id, { by: 'auto' });
        return;
      }
      if (mode !== 'now' && now >= d.endsAt - REMIND_BEFORE_MS && this.reminded !== day) {
        this.reminded = day;
        this.emit('reminder', this.snapshot());
      }
      const soonest = Math.min(autoAt, this.reminded === day ? Infinity : d.endsAt - REMIND_BEFORE_MS);
      return this.schedule(Math.min(nextCheckIn({ daily: d, watching: this.watching(), now }), Math.max(1000, soonest - now)));
    }
    this.schedule(nextCheckIn({ daily: d, watching: this.watching(), now, error: this.error }));
  }

  schedule(ms) {
    if (!this.running) return;
    this.timer && this.timers.clear(this.timer);
    this.timer = this.timers.set(() => {
      this.timer = null;
      this.refresh();
    }, ms);
  }

  /**
   * Claims a challenge (the daily one unless `id` says another) and returns Kick's reel for the
   * reveal. If it was already claimed elsewhere, says so ({ alreadyClaimed }) rather than failing.
   * @param {string} [id]
   * @param {{ by?: 'you'|'auto'|'multiview' }} [o]
   */
  async claim(id = this.daily?.id, { by = 'you' } = {}) {
    if (!id) return { error: 'There’s no daily reward to claim.' };
    if (this.claiming) return { error: 'It’s being claimed already.' };
    this.claiming = true;
    try {
      const reel = reelOf(await this.kick.claimDaily(id), this.rarities);
      const isDaily = id === this.daily?.id;
      if (isDaily) {
        this.saved = { day: dayOf(this.daily.startsAt ?? this.now()), reel, by };
        this.slot?.save?.(this.saved);
        this.daily = { ...this.daily, state: 'claimed', minutes: this.daily.threshold };
      } else this.extras = this.extras.filter((e) => e.id !== id);
      this.history?.add('daily-reward', { ...claimText(reel), rewardImage: reel.winner?.image ?? null, rarity: reel.winner?.rarity, duplicate: reel.duplicate, by });
      this.emit('claimed', { reel, by });
      this.emit('change');
      this.claiming = false;
      // The card list, level and streak changed.
      this.refresh({ full: true });
      return reel;
    } catch (err) {
      this.claiming = false;
      if (err?.status === 401 || err?.status === 403) {
        this.emit('auth-lost');
        return { error: 'Kick asked you to sign in again.' };
      }
      // Claimed already (kick.com, another app)? Then show what's there instead of an error.
      await this.refresh();
      const now = id === this.daily?.id ? this.daily : this.extras.find((e) => e.id === id);
      if (!now || now.state === 'claimed') return { alreadyClaimed: true };
      return { error: 'Kick didn’t accept the claim. Try again in a moment.' };
    }
  }

  /** Today's claim's reel, for Replay. */
  lastClaim() {
    const d = this.daily;
    return d && this.saved?.reel && this.saved.day === dayOf(d.startsAt ?? this.now()) ? this.saved.reel : null;
  }

  /** What the pages draw. */
  snapshot() {
    const d = this.daily;
    if (!this.running) return null;
    if (!d) return { state: this.error ? 'unavailable' : 'loading', extras: [] };
    const reel = this.lastClaim();
    const collection = this.collection ?? { owned: 0, total: 0, byRarity: {} };
    const winner = reel?.winner ?? d.winner;
    return {
      state: d.state,
      id: d.id,
      minutes: d.minutes,
      threshold: d.threshold,
      endsAt: d.endsAt,
      watching: !!this.watching(),
      streak: this.streak,
      level: this.level,
      odds: d.odds,
      collection,
      duplicateChance: duplicateChance(d.odds, collection.byRarity),
      media: this.kickMedia ? d.media : null,
      claiming: this.claiming,
      claimMode: claimMode(this.settings()),
      today:
        d.state === 'claimed'
          ? {
              winner: winner ?? null,
              duplicate: reel ? reel.duplicate : !!d.consolation,
              xpMinutes: reel?.xpMinutes ?? 0,
              levelTo: reel?.levelTo ?? null,
              by: reel ? this.saved.by : 'elsewhere',
              replay: !!reel?.items?.length,
            }
          : null,
      extras: this.extras.map((e) => ({ id: e.id, name: e.name, condition: e.condition, state: e.state, minutes: e.minutes, threshold: e.threshold })),
    };
  }
}

module.exports = {
  DailyReward,
  RARITIES,
  CLAIM_MODES,
  unwrap,
  mediaUrl,
  oddsOf,
  readChallenge,
  readChallenges,
  cardOf,
  collectionOf,
  duplicateChance,
  reelOf,
  levelOf,
  claimMode,
  nextCheckIn,
  claimText,
  dayOf,
  AUTO_BEFORE_MS,
  OPENED_MS,
  REMIND_BEFORE_MS,
};
