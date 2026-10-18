// A local copy of every drop campaign the app has seen: its details, your last
// known progress and its images. Kick's campaign list keeps ended drops (status
// "expired") for a few months and then drops them, and your progress on them may
// go sooner, so the Done tab and the History view read them from here. Stored in the
// app's database (db.js), one row per drop, with the images in drop-images/.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const DAY = 86_400_000;
const KEEP_DAYS = 400; // the same as the history
const RETRY_MS = 3600_000; // after a failed image download
const SCHEME = 'pd-img';
const FILE_RE = /^[a-f0-9]{24}\.(png|jpg|gif|webp|svg|avif)$/;
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif' };
const TYPE = Object.fromEntries(Object.entries(EXT).map(([type, ext]) => [ext, type]));

/** The parts of a Kick campaign worth keeping (not its channel list, which can be long). */
function slim(c) {
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    starts_at: c.starts_at,
    ends_at: c.ends_at,
    connect_url: c.connect_url || null,
    url: c.url || null, // its "About" page: an event, a category or the publisher's site
    category: c.category && { id: c.category.id, name: c.category.name, slug: c.category.slug, image_url: c.category.image_url || c.category.banner_image_url || null },
    organization: c.organization && { name: c.organization.name, logo_url: c.organization.logo_url || null },
    channelCount: c.channels?.length ?? 0,
    rewards: (c.rewards ?? []).map((r) => ({ id: r.id, name: r.name, required_units: r.required_units, image_url: r.image_url })),
  };
}

/** A data: URI as bytes and a type. */
function decodeData(url) {
  const m = /^data:([^;,]+)((?:;[^;,]*)*),(.*)$/s.exec(url);
  if (!m) return null;
  const base64 = /;base64/.test(m[2]);
  return { type: m[1], buffer: base64 ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8') };
}

class DropArchive extends EventEmitter {
  /**
   * dir: the data folder (for drop-images/), db: the app's database (db.js).
   * fetchImage(url) -> { buffer, type } downloads one image
   * (main.js uses the Kick session, so it looks like the site loading it).
   * resolveUrl turns a Kick image path into a full URL.
   */
  constructor(dir, db, { fetchImage, resolveUrl = (u) => u } = {}) {
    super();
    this.db = db;
    this.imageDir = path.join(dir, 'drop-images');
    this.fetchImage = fetchImage;
    this.resolveUrl = resolveUrl;
    this.campaigns = {}; // id -> { raw, progress, firstSeen, lastSeen, goneAt, claimedAt }
    this.images = {}; // remote url -> file name in imageDir
    this.failed = new Map(); // remote url -> last failure time
    this.queue = [];
    this.pumping = null;
    this.saveTimer = null;
    this.saved = { campaigns: new Map(), images: new Map() }; // what the database has, as written
  }

  load() {
    try {
      const { drops, images } = this.db.loadDrops();
      this.campaigns = drops;
      this.images = images;
      for (const [id, entry] of Object.entries(drops)) this.saved.campaigns.set(id, JSON.stringify(entry));
      for (const [url, name] of Object.entries(images)) this.saved.images.set(url, name);
    } catch {}
    this.prune();
    this.write();
    return this;
  }

  save() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.write();
    }, 2000);
  }

  /** Writes any pending change now (on quit). */
  flush() {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.write();
  }

  /** Writes the drops and images that changed since the last write, together. */
  write() {
    const drops = {};
    const images = {};
    const current = new Map(Object.entries(this.campaigns).map(([id, entry]) => [id, JSON.stringify(entry)]));
    for (const [id, json] of current) if (this.saved.campaigns.get(id) !== json) drops[id] = this.campaigns[id];
    for (const id of this.saved.campaigns.keys()) if (!current.has(id)) drops[id] = null;
    for (const [url, name] of Object.entries(this.images)) if (this.saved.images.get(url) !== name) images[url] = name;
    for (const url of this.saved.images.keys()) if (!(url in this.images)) images[url] = null;
    if (!Object.keys(drops).length && !Object.keys(images).length) return;
    try {
      this.db.saveDrops(drops, images);
      this.saved = { campaigns: current, images: new Map(Object.entries(this.images)) };
    } catch {}
  }

  /**
   * Called with Kick's latest campaigns and progress. Keeps every campaign's details
   * fresh, notes the ones Kick no longer lists and when each reward was first seen
   * claimed, and starts downloading any images not stored yet. Returns the
   * campaigns that just ended or left Kick's list, and ones that came back (Kick
   * relisted them or moved their end date).
   */
  update(rawCampaigns, progress, now = Date.now()) {
    const listed = new Set();
    const ended = [];
    const back = [];
    const over = (entry) => this.over(entry, now);
    for (const c of rawCampaigns ?? []) {
      if (!c?.id) continue;
      listed.add(c.id);
      let known = this.campaigns[c.id];
      // An entry rebuilt from history becomes a real one, without counting as "back".
      if (known?.fromHistory) {
        delete known.fromHistory;
        known.claimedAt ??= {};
        known = null;
      }
      const wasOver = known?.raw ? over(known) : false;
      const entry = (this.campaigns[c.id] ??= { firstSeen: now, progress: null, claimedAt: {} });
      entry.raw = slim(c);
      entry.lastSeen = now;
      entry.goneAt = null;
      if (known?.raw && wasOver !== over(entry)) (wasOver ? back : ended).push(c.id);
    }
    for (const p of progress ?? []) {
      const entry = this.campaigns[p.id];
      if (!entry) continue;
      entry.progress = { units: p.progress_units ?? 0, rewards: (p.rewards ?? []).map((r) => ({ id: r.id, claimed: !!r.claimed, progress: r.progress ?? 0 })) };
      for (const r of p.rewards ?? []) if (r.claimed) entry.claimedAt[r.id] ??= now;
    }
    for (const [id, entry] of Object.entries(this.campaigns)) {
      if (listed.has(id) || entry.goneAt) continue;
      if (!over(entry)) ended.push(id);
      entry.goneAt = now;
    }
    for (const url of this.imageUrls((e) => !this.over(e, now) || this.involved(e))) this.want(url);
    this.save();
    this.pump();
    return { ended, back };
  }

  /**
   * Drops the history mentions that the archive never saw (Kick dropped them before
   * this version ran): a basic entry each, from what the history recorded: the name,
   * category, minutes credited and anything claimed. Details and artwork weren't kept.
   */
  backfill(events) {
    const found = new Map();
    const get = (id, e) => {
      if (!found.has(id)) found.set(id, { id, name: null, categoryId: e.categoryId, category: e.category, first: e.t, last: e.t, units: 0, claims: [], complete: false });
      const d = found.get(id);
      d.first = Math.min(d.first, e.t);
      d.last = Math.max(d.last, e.t);
      d.categoryId ??= e.categoryId;
      d.category ??= e.category;
      return d;
    };
    for (const e of events) {
      if (e.campaignId) {
        const d = get(e.campaignId, e);
        d.name ??= e.campaign;
        if (e.type === 'credit' && e.units !== undefined) d.units = Math.max(d.units, e.units);
        if (e.type === 'claim') d.claims.push({ id: e.rewardId ?? `history-${d.claims.length}`, name: e.reward, image: e.rewardImage ?? null, required: e.required ?? 0, t: e.t });
        if (e.type === 'campaign-complete') d.complete = true;
      }
      (e.campaignIds ?? []).forEach((id, i) => {
        const d = get(id, e);
        d.name ??= e.campaigns?.[i];
      });
    }
    let added = 0;
    for (const d of found.values()) {
      if (this.campaigns[d.id] || !d.name || d.categoryId == null) continue;
      const at = new Date(d.last).toISOString();
      this.campaigns[d.id] = {
        fromHistory: true,
        complete: d.complete,
        raw: {
          id: d.id,
          name: d.name,
          status: 'expired',
          starts_at: new Date(d.first).toISOString(),
          ends_at: at,
          connect_url: null,
          category: { id: d.categoryId, name: d.category ?? null, image_url: null },
          organization: null,
          channelCount: 0,
          rewards: d.claims.map((r) => ({ id: r.id, name: r.name, required_units: r.required, image_url: r.image })),
        },
        progress: { units: d.units, rewards: d.claims.map((r) => ({ id: r.id, claimed: true, progress: 1 })) },
        claimedAt: Object.fromEntries(d.claims.map((r) => [r.id, r.t])),
        firstSeen: d.first,
        lastSeen: d.last,
        goneAt: d.last,
      };
      added += 1;
    }
    if (added) this.save();
    return added;
  }

  /** Has it ended, or left Kick's list? */
  over(entry, now = Date.now()) {
    return !!entry.goneAt || new Date(entry.raw?.ends_at).getTime() <= now;
  }

  /**
   * Did you have a stake in it: seen running by the app, or with progress or a claim
   * on your account? Old drops that ended before you used the app don't count (Kick
   * lists months of them).
   */
  involved(entry) {
    if (!entry?.raw) return false;
    return !!entry.fromHistory || (entry.progress?.units ?? 0) > 0 || Object.keys(entry.claimedAt ?? {}).length > 0 || entry.firstSeen < new Date(entry.raw.ends_at).getTime();
  }

  /** The images archived campaigns use (all, or those passing `filter`), as full URLs. */
  imageUrls(filter = () => true) {
    const urls = new Set();
    for (const entry of Object.values(this.campaigns)) {
      const raw = entry.raw;
      if (!raw || !filter(entry)) continue;
      for (const u of [raw.category?.image_url, raw.organization?.logo_url, ...raw.rewards.map((r) => r.image_url)]) {
        const full = u && this.resolveUrl(u);
        if (full) urls.add(full);
      }
    }
    return urls;
  }

  want(url) {
    if (this.images[url] || this.queue.includes(url)) return;
    const failedAt = this.failed.get(url);
    if (failedAt && Date.now() - failedAt < RETRY_MS) return;
    this.queue.push(url);
  }

  /** Downloads queued images one at a time. Resolves when the queue is empty. */
  pump() {
    if (!this.fetchImage) return Promise.resolve();
    this.pumping ??= this.drain().finally(() => {
      this.pumping = null;
      if (this.queue.length) this.pump();
    });
    return this.pumping;
  }

  async drain() {
    let added = 0;
    while (this.queue.length) {
      const url = this.queue.shift();
      try {
        const got = url.startsWith('data:') ? decodeData(url) : await this.fetchImage(url);
        const ext = EXT[String(got?.type ?? '').split(';')[0].trim().toLowerCase()];
        if (!got?.buffer?.length || !ext) throw new Error('not an image');
        const name = `${crypto.createHash('sha1').update(url).digest('hex').slice(0, 24)}.${ext}`;
        await fs.promises.mkdir(this.imageDir, { recursive: true });
        await fs.promises.writeFile(path.join(this.imageDir, name), got.buffer);
        this.images[url] = name;
        this.failed.delete(url);
        added += 1;
      } catch {
        this.failed.set(url, Date.now());
      }
    }
    if (added) {
      this.save();
      this.emit('images', added);
    }
  }

  /** The stored copy of an image (an app URL), or the original while it downloads. */
  img(url) {
    if (!url) return url ?? null;
    if (url.startsWith(`${SCHEME}:`)) return url; // already a stored copy
    const full = this.resolveUrl(url);
    const name = this.images[full];
    return name ? `${SCHEME}://drop/${name}` : full;
  }

  /** The file behind an app image URL, or null for anything else. */
  fileFor(appUrl) {
    try {
      const u = new URL(appUrl);
      const name = u.pathname.replace(/^\//, '');
      if (u.protocol !== `${SCHEME}:` || u.hostname !== 'drop' || !FILE_RE.test(name)) return null;
      return { path: path.join(this.imageDir, name), type: TYPE[name.split('.').pop()] };
    } catch {
      return null;
    }
  }

  get(id) {
    return this.campaigns[id] ?? null;
  }

  entries() {
    return Object.values(this.campaigns).filter((e) => e.raw);
  }

  /** Drops campaigns last seen over a year ago, and images nothing uses any more. */
  prune(now = Date.now()) {
    for (const [id, entry] of Object.entries(this.campaigns)) {
      if (!entry.raw || now - (entry.lastSeen ?? 0) > KEEP_DAYS * DAY) delete this.campaigns[id];
    }
    const used = this.imageUrls();
    for (const [url, name] of Object.entries(this.images)) {
      if (used.has(url)) continue;
      delete this.images[url];
      fs.promises.unlink(path.join(this.imageDir, name)).catch(() => {});
    }
  }
}

module.exports = { DropArchive, SCHEME, slim, decodeData };
