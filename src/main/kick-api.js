const { app, BrowserWindow, session } = require('electron');
const { devEnv } = require('./guard');

// Demo mode uses a throwaway session with the stand-in Kick (src/main/demo.js).
const PARTITION = devEnv({ packaged: !!app?.isPackaged })('PD_DEMO') ? 'pd-demo' : 'persist:kick';
const KICK = 'https://kick.com';
const WEB = 'https://web.kick.com';
const ASSETS = 'https://ext.kick.com/';

class ApiError extends Error {
  constructor(status, url, body) {
    super(`HTTP ${status} for ${url}`);
    this.status = status;
    this.body = body;
  }
}

/**
 * Runs every request from inside a hidden kick.com page so it carries the same
 * origin, cookies, TLS fingerprint and headers as Kick's own web client.
 */
class KickApi {
  constructor() {
    this.win = null;
    this.loading = null;
  }

  get session() {
    return session.fromPartition(PARTITION);
  }

  async ensureWindow() {
    if (this.win && !this.win.isDestroyed()) return this.loading;
    this.win = new BrowserWindow({
      show: false,
      webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    this.win.webContents.setAudioMuted(true);
    this.loading = this.win.loadURL(`${KICK}/robots.txt`).catch(() => {});
    return this.loading;
  }

  /** Whether a Kick login cookie exists (its value stays in the cookie store). */
  async hasLogin() {
    const cookies = await this.session.cookies.get({ url: KICK, name: 'session_token' }).catch(() => []);
    return cookies.some((c) => c.value);
  }

  async request(url, { method = 'GET', body, auth = true, query } = {}) {
    await this.ensureWindow();
    if (query) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        [].concat(value).forEach((v) => params.append(key, String(v)));
      }
      url += (url.includes('?') ? '&' : '?') + params.toString();
    }
    // The login token is read inside the kick.com page and never leaves it.
    const payload = { url, method, body: body === undefined ? null : JSON.stringify(body), auth };
    const script = `(async (p) => {
      const cookie = (n) => { const m = document.cookie.match(new RegExp('(?:^|; )' + n + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : ''; };
      const headers = { Accept: 'application/json', 'x-app-platform': 'web' };
      const token = p.auth ? cookie('session_token') : '';
      const xsrf = p.auth ? cookie('XSRF-TOKEN') : '';
      if (token) headers.Authorization = 'Bearer ' + token;
      if (xsrf) headers['X-XSRF-TOKEN'] = xsrf;
      const init = { method: p.method, headers, credentials: p.auth ? 'include' : 'omit', cache: 'no-cache' };
      if (p.body !== null) { headers['Content-Type'] = 'application/json'; init.body = p.body; }
      try {
        const res = await fetch(p.url, init);
        const text = await res.text();
        let json = null;
        try { json = JSON.parse(text); } catch {}
        return { status: res.status, ok: res.ok, json, text: json ? null : text.slice(0, 300) };
      } catch (err) {
        return { status: 0, ok: false, json: null, text: String(err) };
      }
    })(${JSON.stringify(payload)})`;
    const res = await this.win.webContents.executeJavaScript(script, true);
    if (!res.ok) throw new ApiError(res.status, url, res.json ?? res.text);
    return res.json;
  }

  // ---- Account ----
  async me() {
    if (!(await this.hasLogin())) return null;
    try {
      return await this.request(`${KICK}/api/v1/user`);
    } catch (err) {
      if (err.status === 401 || err.status === 403) return null;
      throw err;
    }
  }

  /**
   * The channels you follow (lower-case slugs), the way Stream Multiview reads
   * them: Kick's follow lists best first, falling back to the next one if a list
   * fails. `followed-page` lists live channels first, and only live channels can
   * earn drops, so reading stops at the first page with none live.
   */
  async followedSlugs({ maxPages = 200 } = {}) {
    for (const base of FOLLOW_APIS) {
      const slugs = new Set();
      let cursor = 0;
      let ok = false;
      for (let page = 0; page < maxPages; page++) {
        const byCursor = base.includes('/v2/');
        let res;
        try {
          res = await this.request(`${KICK}${base}`, { query: byCursor ? { cursor } : { page: page + 1 } });
        } catch (err) {
          if (err.status === 401 || err.status === 403) throw err;
          break;
        }
        ok = true;
        const found = followsFrom(res);
        found.forEach((f) => slugs.add(f.slug));
        // Who's live, when the list says: the queue then needn't ask about an offline followed channel.
        if (found.some((f) => f.live !== null)) {
          slugs.live ??= new Set();
          found.filter((f) => f.live).forEach((f) => slugs.live.add(f.slug));
        }
        const next = res?.nextCursor ?? res?.next_cursor ?? res?.meta?.next_cursor ?? res?.meta?.nextCursor ?? (res?.next_page_url ? 'next' : null);
        const anyLive = found.some((f) => f.live);
        const knowsLive = found.some((f) => f.live !== null);
        if (!found.length || next == null || (byCursor && next === cursor) || (knowsLive && !anyLive)) break;
        cursor = next;
      }
      if (ok && slugs.size) return slugs;
      if (ok) return slugs; // follows nobody
    }
    return new Set();
  }

  /** The emotes your account can use (sets: channels, Global, your unlocked ones). */
  async myEmotes() {
    const res = await this.request(`${KICK}/emotes`);
    const sets = Array.isArray(res) ? res : (res?.data ?? []);
    return sets.flatMap((set) => (Array.isArray(set?.emotes) ? set.emotes : [])).filter((e) => e?.id && e?.name);
  }

  // ---- Drops ----
  async campaigns() {
    const res = await this.request(`${WEB}/api/v1/drops/campaigns`);
    return res?.data ?? [];
  }

  async progress() {
    const res = await this.request(`${WEB}/api/v1/drops/progress`);
    return res?.data ?? [];
  }

  async campaignsForLivestream(channelId, categoryId) {
    const res = await this.request(`${WEB}/api/v1/drops/campaigns/livestream`, {
      query: { channel_id: channelId, category_id: categoryId },
    });
    return res?.data ?? [];
  }

  async claim(campaignId, rewardId) {
    return this.request(`${WEB}/api/v1/drops/claim`, {
      method: 'POST',
      body: { reward_id: rewardId, campaign_id: campaignId },
    });
  }

  // ---- Following (the same calls kick.com's own Follow button makes) ----
  // ---- Daily reward (gamification). Every reply is { data, message } ----
  async dailyChallenges(query) {
    return this.request(`${WEB}/api/v1/gamification/challenges`, { query });
  }

  async collectibles() {
    return this.request(`${WEB}/api/v1/gamification/collectibles`);
  }

  async level() {
    return this.request(`${WEB}/api/v1/gamification/user/level`);
  }

  async streak(userId) {
    return this.request(`${WEB}/api/v1/gamification/users/${encodeURIComponent(userId)}/streak`);
  }

  /** Really claims: only from the user's Claim, or the automatic claim they chose. */
  async claimDaily(challengeId) {
    return this.request(`${WEB}/api/v1/gamification/challenges/${encodeURIComponent(challengeId)}/claim`, { method: 'POST', body: {} });
  }

  async follow(slug) {
    return this.request(`${KICK}/api/v2/channels/${encodeURIComponent(slug)}/follow`, { method: 'POST' });
  }

  async unfollow(slug) {
    return this.request(`${KICK}/api/v2/channels/${encodeURIComponent(slug)}/follow`, { method: 'DELETE' });
  }

  // ---- Streams ----
  async livestreams(categoryId, { maxPages = 3, limit = 100, stopWhen } = {}) {
    const out = [];
    let after;
    for (let page = 0; page < maxPages; page++) {
      const res = await this.request(`${WEB}/api/v1/livestreams`, {
        auth: false,
        query: { limit, sort: 'viewer_count_desc', category_id: categoryId, after },
      });
      const list = res?.data?.livestreams ?? [];
      out.push(...list);
      after = res?.data?.pagination?.next_cursor;
      if (!after || list.length < limit || (stopWhen && stopWhen(out))) break;
    }
    return out;
  }

  /**
   * The live streams of a Kick event (a campaign's url can be kick.com/events/<slug>), in the
   * shape livestreams() returns. The event's own list finds a campaign's channels however small,
   * which a category's top streams can miss. The streams don't say their category.
   */
  async eventStreams(event, { maxPages = 3 } = {}) {
    const out = [];
    let cursor;
    const seen = new Set();
    for (let page = 0; page < maxPages; page++) {
      const res = await this.request(`${WEB}/api/v1/events/${encodeURIComponent(event)}/streams`, { auth: false, query: { cursor } });
      for (const s of res?.data?.streams ?? []) {
        if (!s?.channel?.id || seen.has(s.channel.id)) continue;
        seen.add(s.channel.id);
        out.push(eventStream(s));
      }
      cursor = res?.data?.next_cursor;
      if (!cursor) break;
    }
    return out;
  }

  async channelInfo(slug) {
    return this.request(`${KICK}/api/v2/channels/${encodeURIComponent(slug)}/info`, { auth: false });
  }

  /** Signs out: its own page and the others using the login (closePages) close, then the login is wiped. */
  async signOut({ closePages } = {}) {
    await wipeSession({
      closePages: async () => {
        if (this.win && !this.win.isDestroyed()) this.win.destroy();
        this.win = null;
        await closePages?.();
      },
    });
  }
}

/**
 * Removes the Kick login and everything Kick saved. The pages using it close first (closePages), so
 * none of them writes it back; then the stored data, the cache and saved HTTP logins go, and the
 * cookie file is written out at once.
 */
async function wipeSession({ closePages = () => {}, ses = session.fromPartition(PARTITION) } = {}) {
  try {
    await closePages();
  } catch {}
  await ses.clearStorageData().catch(() => {});
  await ses.clearCache().catch(() => {});
  await ses.clearAuthCache().catch(() => {});
  await ses.cookies.flushStore().catch(() => {});
}

// Kick's follow lists, best first: followed-page gives 20 a page (live first),
// followed only 5, and the old v1 list pages by number.
const FOLLOW_APIS = ['/api/v2/channels/followed-page', '/api/v2/channels/followed', '/api/v1/user/following'];
const SLUG_RE = /^[a-z0-9_-]{2,40}$/i;

/** Channel slugs (and whether each is live, when Kick says) from any of Kick's follow lists. */
function followsFrom(data) {
  const out = new Map();
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== 'object') return;
    const slug = o.channel_slug || o.slug;
    const channelLike = o.channel_slug || 'user_username' in o || 'user' in o || 'username' in o || 'followers_count' in o || 'is_live' in o || 'livestream' in o;
    if (typeof slug === 'string' && channelLike && SLUG_RE.test(slug) && !out.has(slug.toLowerCase())) {
      const live = typeof o.is_live === 'boolean' ? o.is_live : 'livestream' in o ? !!o.livestream : null;
      out.set(slug.toLowerCase(), { slug: slug.toLowerCase(), live });
    }
    for (const k in o) if (o[k] && typeof o[k] === 'object') walk(o[k]);
  };
  walk(data);
  return [...out.values()];
}

const assetUrl = (path) => (!path ? null : /^(https?|data):/.test(path) ? path : ASSETS + path.replace(/^\//, ''));

/** The event a campaign belongs to, from its url (kick.com/events/<slug or id>), or null. */
function eventOf(url) {
  const m = /^https:\/\/(?:www\.)?kick\.com\/events\/([\w-]+)\/?(?:[?#].*)?$/.exec(String(url ?? ''));
  return m ? m[1] : null;
}

/** An event's stream, as livestreams() has them. */
function eventStream(s) {
  return {
    title: s.livestream?.title ?? '',
    viewer_count: s.livestream?.view_count ?? 0,
    thumbnail: { src: s.livestream?.thumbnail?.src ?? null },
    language: s.livestream?.language,
    is_mature: !!s.livestream?.is_mature,
    channel: { id: s.channel.id, slug: s.channel.slug, username: s.user?.username ?? s.channel.slug, profile_pic: s.user?.profile_picture_url ?? null },
    fromEvent: true,
  };
}

module.exports = { KickApi, ApiError, PARTITION, KICK, assetUrl, wipeSession, followsFrom, FOLLOW_APIS, eventOf, eventStream };
