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

// An event's look, from its name and where Kick keeps its videos (Trick or Treat's are in
// rewards/halloween-2610/): Kick sends no theme. Anything else is a plain 'event'.
const THEMES = [
  ['halloween', /hallowe'?en|trick.?or.?treat|spook|pumpkin|haunt/i],
  ['winter', /christmas|x-?mas|holiday|winter|snow|santa|festive|frost/i],
  ['valentine', /valentine|sweetheart/i],
  ['newyear', /new.?year|countdown|\bnye\b/i],
  ['spring', /easter|spring|bunny|bloom/i],
  ['summer', /summer|beach|sunshine/i],
];
function themeOf(name, idleUrl) {
  const words = `${name ?? ''} ${typeof idleUrl === 'string' && idleUrl.startsWith(MEDIA_HOST) ? idleUrl.slice(MEDIA_HOST.length) : ''}`;
  return THEMES.find(([, re]) => re.test(words))?.[0] ?? 'event';
}

/** One challenge, in the app's words: earning, ready or claimed. */
function readChallenge(c) {
  if (!c || typeof c !== 'object' || c.id == null) return null;
  const threshold = Math.max(1, num(c.condition?.threshold, 60));
  const state = c.status === 'claimable' ? 'ready' : c.status === 'claimed' ? 'claimed' : 'earning';
  return {
    id: String(c.id),
    name: typeof c.name === 'string' ? c.name : '',
    description: typeof c.description === 'string' ? c.description.trim() : '',
    recurrence: c.recurrence ?? 'daily',
    condition: c.condition?.type ?? 'watch_time_minutes',
    state,
    minutes: state === 'earning' ? Math.min(threshold, Math.max(0, Math.floor(num(c.condition?.progress)))) : threshold,
    threshold,
    startsAt: time(c.window?.starts_at),
    endsAt: time(c.window?.ends_at),
    featured: !!c.featured,
    // An event's crate (Kick's Trick or Treat) resets daily like the daily one, until its event ends.
    until: time(c.active_period?.ends_at),
    from: time(c.active_period?.starts_at),
    revealType: c.reveal_type ?? null,
    odds: oddsOf(c.drop_table),
    media: { idle: mediaUrl(c.animations?.idle_url, `${MEDIA}idle`), unbox: mediaUrl(c.animations?.unbox_url, `${MEDIA}unbox`) },
    ownMedia: typeof c.animations?.idle_url === 'string' && c.animations.idle_url.startsWith(MEDIA_HOST),
    theme: themeOf(c.name, c.animations?.idle_url),
    winner: c.winner ? cardOf(c.winner) : null,
    consolation: c.consolation ?? null,
  };
}

/**
 * The daily one and the rest: an event's crate (Kick lists it as another daily challenge, featured,
 * with videos and odds of its own) or the Welcome Reward. Only the others Pear Drops can do
 * something about: one that's ready to claim, one that fills by watching, or an event's that was
 * claimed today (it stays, showing what it gave). The Welcome Reward waits on Kick's own sign-up
 * steps, a pop-up kick.com shows when it chooses, with no link to it.
 */
function readChallenges(body, oneOff = null) {
  const all = [...listOf(body), ...listOf(oneOff)].map(readChallenge).filter(Boolean);
  const unique = [...new Map(all.map((c) => [c.id, c])).values()];
  const watched = unique.filter((c) => c.recurrence === 'daily' && c.condition === 'watch_time_minutes');
  const daily = watched.find((c) => !c.featured) ?? watched[0] ?? null;
  const extras = unique.filter(
    (c) => c !== daily && (c.state === 'ready' || (c.state === 'earning' && c.condition === 'watch_time_minutes') || (c.state === 'claimed' && c.recurrence === 'daily')),
  );
  return { daily, extras };
}

// Kick's card pictures are https; the demo's are drawn as data images.
const isImage = (u) => typeof u === 'string' && (u.startsWith('https://') || u.startsWith('data:image/'));

/**
 * A card as the pages show it: its picture says its name, so there's no name. An event's prize
 * isn't one of the collectible cards: no card picture, just a square one, and no type.
 * @param {Map<string, string>} [types] the collectible cards' types, by id (Kick's winners come without)
 */
function cardOf(c, types = new Map()) {
  if (!c || typeof c !== 'object') return null;
  const image = [c.card_url, c.thumbnail_url, c.item_url, c.image_url].find(isImage) ?? null;
  const id = c.id == null ? null : String(c.id);
  const type = ['badge', 'emote'].includes(c.type) ? c.type : (types.get(id) ?? null);
  const card = { id, rarity: RARITIES.includes(c.rarity) ? c.rarity : 'common', type, image, square: !isImage(c.card_url) };
  // Some crates give watch time towards your Kick level instead of an emote or badge.
  return c.watch_time ? { ...card, xp: num(c.watch_time.watch_time_minutes), levelTo: badgeLevel(c.watch_time.next_level_badge) } : card;
}

/** The level a "next level" badge is for. */
function badgeLevel(badge) {
  const level = num(badge?.metadata?.level ?? badge?.level, NaN);
  return Number.isFinite(level) ? level : null;
}

// What Kick's rewards list calls each kind of prize.
const PRIZE_TYPES = ['emote', 'badge', 'kicks', 'redeemable_code'];

/** When Kick made an id: its ids are UUIDv7, which start with the time in ms. */
function idTime(id) {
  const hex = typeof id === 'string' ? id.replace(/-/g, '') : '';
  if (!/^[0-9a-f]{32}$/i.test(hex) || hex[12] !== '7') return null;
  return parseInt(hex.slice(0, 12), 16);
}

/**
 * Kick's rewards list (kick.com's rewards page): everything the account has won, drops and event
 * crates alike, by name. An event crate's prize says which event in `source_label`, and its id
 * says when it was won.
 */
function rewardsOf(body) {
  const d = unwrap(body);
  const list = Array.isArray(d) ? d : Array.isArray(d?.rewards) ? d.rewards : [];
  return list
    .filter((r) => r && typeof r === 'object' && r.reward_id != null)
    .map((r) => ({
      id: String(r.reward_id),
      name: typeof r.display_label === 'string' ? r.display_label : '',
      type: PRIZE_TYPES.includes(r.type) ? r.type : null,
      rarity: RARITIES.includes(r.rarity) ? r.rarity : 'common',
      image: isImage(r.thumbnail_url) ? r.thumbnail_url : null,
      source: typeof r.source === 'string' ? r.source : '',
      label: typeof r.source_label === 'string' ? r.source_label : '',
      at: idTime(r.id),
    }));
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
function reelOf(reply, rarities = new Map(), types = new Map()) {
  const r = unwrap(reply) ?? {};
  const winner = cardOf(r.winner, types);
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
  return {
    items: items.map(({ image, rarity }) => ({ image, rarity })),
    winnerIndex: Math.max(0, winnerIndex),
    winner,
    duplicate: !!consolation,
    xpMinutes: consolation ? num(consolation.watch_time_minutes, 0) : (winner?.xp ?? 0),
    levelTo: consolation ? badgeLevel(consolation.next_level_badge) : (winner?.levelTo ?? null),
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
function nextCheckIn({ daily, extras = [], watching, now, error = false }) {
  if (error) return RETRY_MS;
  if (!daily) return IDLE_MS;
  const reset = daily.endsAt ? Math.max(1000, daily.endsAt - now + 5000) : Infinity;
  // An event's crate fills from the same watching: the soonest of them.
  const earning = [daily, ...extras].filter((c) => c.state === 'earning' && c.condition === 'watch_time_minutes');
  let next = IDLE_MS;
  if (earning.length && watching) next = Math.min(EARNING_MS, ...earning.map((c) => Math.max(5000, (c.threshold - c.minutes) * MIN + 30_000)));
  else if (daily.state === 'claimed' && !extras.some((c) => c.state !== 'claimed')) next = reset;
  return Math.min(next, reset);
}

/** A prize's kind in words: "Rare emote", "Common KICKs". */
function kindOf(card) {
  const type = { kicks: 'KICKs', redeemable_code: 'code' }[card?.type] ?? card?.type ?? 'reward';
  return `${card?.rarity ? card.rarity[0].toUpperCase() + card.rarity.slice(1) : 'Common'} ${type}`;
}

/** What the record in History says about a claim: an event's crate says its name first, then the prize's. */
function claimText(reel, crate = null) {
  const kind = kindOf(reel.winner);
  const from = crate ? `${crate}: ` : '';
  const toLevel = reel.levelTo ? ` to Level ${reel.levelTo}` : '';
  if (reel.winner?.xp) return { reward: `+${reel.winner.xp} min watch time`, text: `${from}+${reel.winner.xp} min watch time${toLevel}` };
  const what = reel.winner?.name ? `${reel.winner.name}, ${kind.toLowerCase()}` : kind;
  if (!reel.duplicate) return { reward: reel.winner?.name || kind, text: `${from}${what}, new to your collection` };
  const xp = reel.xpMinutes ? `, +${reel.xpMinutes} min watch time${toLevel}` : '';
  return { reward: reel.winner?.name || kind, text: `${from}${what}, a duplicate${xp}` };
}

const NAME_WAIT_MS = 2500; // how long a claim waits for Kick's rewards list to name the prize
const PRIZES_KEPT = 40;
const SAME_CLAIM_MS = 6 * 60 * MIN;

/** An event's prizes with more added: one each (by prize and time), newest first. */
function mergePrizes(kept = [], more = []) {
  // The same prize twice within hours is one claim, seen twice (as claimed here, then in Kick's list).
  const all = [];
  for (const p of [...more, ...kept]) if (!all.some((q) => q.id === p.id && (!q.at || !p.at || Math.abs(q.at - p.at) < SAME_CLAIM_MS))) all.push(p);
  return all
    .map(({ id, name, type, rarity, image, at, xp }) => ({ id, name: name || null, type: type ?? null, rarity, image: image ?? null, at: at ?? null, ...(xp ? { xp } : {}) }))
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
    .slice(0, PRIZES_KEPT);
}

class DailyReward extends EventEmitter {
  /**
   * @param {object} o
   * @param {object} o.kick dailyChallenges(query), collectibles(), level(), streak(userId), claimDaily(id), and rewards() for event prizes' names
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
    // { day, reel, by, events: { [id]: { day, reel, by } }, won: { [event]: prize[] } }: the last
    // claims (the daily one's and each event crate's), for the card and Replay, and every event's
    // prizes (Kick's rewards list may not keep them all).
    this.saved = { ...(slot?.load?.() ?? {}) };
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
    this.types = new Map();
    this.prizes = new Map(); // Kick's rewards list, by prize id: names for an event's prizes
    this.error = false;
    this.claiming = false;
    this.reminded = null; // the day "an hour left" was said
    this.autoTried = {}; // challenge id -> the day an automatic claim was tried
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
    const wasExtras = new Map(this.extras.map((e) => [e.id, e.state]));
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
    for (const e of this.extras) if (e.state === 'ready' && wasExtras.get(e.id) === 'earning') this.emit('crate-ready', { id: e.id, name: e.name, endsAt: e.recurrence === 'daily' ? e.endsAt : null });
    this.emit('change');
    this.afterRefresh();
  }

  async refreshCards() {
    const uid = this.userId?.();
    const [cards, level, streak] = await Promise.all([
      this.kick.collectibles().catch(() => null),
      this.kick.level().catch(() => null),
      uid != null ? this.kick.streak(uid).catch(() => null) : null,
      this.refreshPrizes(),
    ]);
    if (cards) {
      this.collection = collectionOf(cards);
      const list = listOf(cards);
      this.rarities = new Map(list.filter((c) => c?.id != null).map((c) => [String(c.id), RARITIES.includes(c.rarity) ? c.rarity : 'common']));
      this.types = new Map(list.filter((c) => c?.id != null && ['badge', 'emote'].includes(c.type)).map((c) => [String(c.id), c.type]));
    }
    if (level) this.level = levelOf(level) ?? this.level;
    if (streak) this.streak = num(unwrap(streak)?.length_days, this.streak ?? 0);
    this.cardsAt = this.now();
  }

  /**
   * Kick's rewards list: the names of an event's prizes, and what each event has given. Only while
   * there's an event's crate (or one was won). Keeps each event's prizes, newest first.
   */
  async refreshPrizes() {
    if (!this.kick.rewards || (!this.extras.some((e) => e.recurrence === 'daily') && !Object.keys(this.saved.won ?? {}).length)) return;
    const list = rewardsOf(await this.kick.rewards().catch(() => null));
    if (!list.length) return;
    this.prizes = new Map(list.map((p) => [p.id, p]));
    const won = { ...this.saved.won };
    for (const p of list.filter((x) => x.label && x.source !== 'drops')) won[p.label] = mergePrizes(won[p.label], [p]);
    this.saved = { ...this.saved, won };
    this.slot?.save?.(this.saved);
  }

  /** A prize with its name and kind from Kick's rewards list, when it's there. */
  named(card) {
    const p = card?.id ? this.prizes.get(card.id) : null;
    return p ? { ...card, name: p.name || card.name || null, type: card.type ?? p.type, image: card.image ?? p.image } : card;
  }

  /**
   * Claims on its own when the user chose so (the daily crate, and an event's, which resets the same
   * way), reminds before the reset, then waits for the next check.
   */
  afterRefresh() {
    const d = this.daily;
    const now = this.now();
    const mode = claimMode(this.settings());
    let soonest = Infinity;
    for (const c of [d, ...this.extras].filter((x) => x?.state === 'ready' && x.endsAt && (x === d || x.recurrence === 'daily'))) {
      const day = dayOf(c.startsAt ?? now);
      const autoAt = mode === 'now' ? now : mode === 'before-reset' ? c.endsAt - AUTO_BEFORE_MS : Infinity;
      if (now >= autoAt && this.autoTried[c.id] !== day) {
        this.autoTried[c.id] = day;
        this.claim(c.id, { by: 'auto' });
        return;
      }
      soonest = Math.min(soonest, autoAt);
    }
    if (d?.state === 'ready' && d.endsAt) {
      const day = dayOf(d.startsAt ?? now);
      if (mode !== 'now' && now >= d.endsAt - REMIND_BEFORE_MS && this.reminded !== day) {
        this.reminded = day;
        this.emit('reminder', this.snapshot());
      }
      if (this.reminded !== day) soonest = Math.min(soonest, d.endsAt - REMIND_BEFORE_MS);
    }
    const next = nextCheckIn({ daily: d, extras: this.extras, watching: this.watching(), now, error: this.error });
    this.schedule(soonest === Infinity ? next : Math.min(next, Math.max(1000, soonest - now)));
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
      const reel = reelOf(await this.kick.claimDaily(id), this.rarities, this.types);
      const isDaily = id === this.daily?.id;
      const crate = isDaily ? null : this.extras.find((e) => e.id === id);
      if (crate && reel.winner && !reel.winner.xp) {
        // Kick's claim says only the prize's picture: its rewards list has its name (briefly, so the reveal isn't held up).
        let wait;
        await Promise.race([this.refreshPrizes(), new Promise((r) => (wait = setTimeout(r, NAME_WAIT_MS)))]).catch(() => {});
        clearTimeout(wait);
        reel.winner = this.named(reel.winner);
        if (crate.name) this.remember(crate.name, { ...reel.winner, at: this.now() });
      }
      if (isDaily) {
        this.saved = { ...this.saved, day: dayOf(this.daily.startsAt ?? this.now()), reel, by };
        this.daily = { ...this.daily, state: 'claimed', minutes: this.daily.threshold };
      } else {
        // An event's crate stays on the card, showing what it gave, until it resets.
        const day = dayOf(crate?.startsAt ?? this.now());
        const events = Object.fromEntries(Object.entries(this.saved.events ?? {}).filter(([, e]) => e.day === day));
        this.saved = { ...this.saved, events: { ...events, [id]: { day, reel, by } } };
        this.extras = this.extras.flatMap((e) => (e.id !== id ? [e] : e.recurrence === 'daily' ? [{ ...e, state: 'claimed', minutes: e.threshold, winner: reel.winner }] : []));
      }
      this.slot?.save?.(this.saved);
      this.history?.add('daily-reward', {
        ...claimText(reel, crate?.name || null),
        ...(crate ? { crate: crate.name || null } : {}),
        rewardImage: reel.winner?.image ?? null,
        rarity: reel.winner?.rarity,
        duplicate: reel.duplicate,
        by,
      });
      this.emit('claimed', { reel, by, crate: crate?.name ?? null });
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

  /** Today's claim's reel (the daily crate's, or the event crate `id`'s), for Replay and See it. */
  lastClaim(id = this.daily?.id) {
    const d = this.daily;
    if (d && id === d.id) return this.saved?.reel && this.saved.day === dayOf(d.startsAt ?? this.now()) ? this.saved.reel : null;
    const e = this.extras.find((x) => x.id === id);
    const s = this.saved?.events?.[id];
    return e && s?.reel && s.day === dayOf(e.startsAt ?? this.now()) ? { ...s.reel, winner: this.named(s.reel.winner) } : null;
  }

  /** Keeps a prize an event gave, with the rest of that event's. */
  remember(event, prize) {
    this.saved = { ...this.saved, won: { ...this.saved.won, [event]: mergePrizes(this.saved.won?.[event], [prize]) } };
  }

  /**
   * What a chest shows (the title bar's, the tray's, a connected app's): the daily crate, or ready
   * when an event's crate is waiting, whatever the daily one is doing.
   */
  chest() {
    const d = this.daily;
    const e = this.extras.find((x) => x.state === 'ready');
    if (!d || d.state === 'ready' || !e) return d;
    return { ...d, state: 'ready', endsAt: e.recurrence === 'daily' && e.endsAt ? e.endsAt : d.endsAt, crate: e.name || null, theme: e.theme };
  }

    /** A winner Kick gave without its type, with the type from the card list (or none: an event's prize). */
  typed(card) {
    return card && !card.type ? { ...card, type: this.types.get(card.id) ?? null } : (card ?? null);
  }

  /** What the pages draw. */
  snapshot() {
    const d = this.daily;
    if (!this.running) return null;
    if (!d) return { state: this.error ? 'unavailable' : 'loading', extras: [] };
    const reel = this.lastClaim();
    const collection = this.collection ?? { owned: 0, total: 0, byRarity: {} };
    const winner = this.typed(reel?.winner ?? d.winner);
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
      // An event's crate waits: the chests say "ready" too.
      crateReady: this.extras.some((e) => e.state === 'ready'),
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
      extras: this.extras.map((e) => {
        const reel = e.state === 'claimed' ? this.lastClaim(e.id) : null;
        const won = e.state === 'claimed' ? this.named(this.typed(reel?.winner ?? e.winner)) : null;
        return {
          id: e.id,
          name: e.name,
          description: e.description,
          recurrence: e.recurrence,
          condition: e.condition,
          state: e.state,
          minutes: e.minutes,
          threshold: e.threshold,
          endsAt: e.recurrence === 'daily' ? e.endsAt : null,
          until: e.until,
          days: e.until && e.from ? Math.round((e.until - e.from) / 86_400_000) : null,
          featured: e.featured,
          theme: e.theme,
          odds: e.odds,
          // Its own crate's videos (an event's), if Kick has them; otherwise the pages draw ours.
          media: this.kickMedia && e.ownMedia ? e.media : null,
          won:
            e.state === 'claimed'
              ? {
                  winner: won,
                  duplicate: reel ? reel.duplicate : !!e.consolation,
                  xpMinutes: reel?.xpMinutes ?? won?.xp ?? 0,
                  levelTo: reel?.levelTo ?? won?.levelTo ?? null,
                  by: reel ? this.saved.events[e.id].by : 'elsewhere',
                  replay: !!reel,
                }
              : null,
          // Everything this event has given, newest first: its strip of prizes.
          prizes: e.name ? (this.saved.won?.[e.name] ?? []).filter((p) => !e.from || !p.at || p.at >= e.from - 86_400_000) : [],
        };
      }),
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
  kindOf,
  rewardsOf,
  idTime,
  mergePrizes,
  dayOf,
  themeOf,
  AUTO_BEFORE_MS,
  OPENED_MS,
  REMIND_BEFORE_MS,
};
