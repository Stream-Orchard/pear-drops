// Connected apps (Settings › Connected apps): other StreamOrchard apps on this computer, linked
// through Grapevine (@streamorchard/grapevine). Pear Drops tells them what it's farming
// (drops.farming), so Stream Multiview can sign its Kick players out and leave the credit here,
// and hears whether those players are signed in (players), so the credit banner can say when
// they're what's taking it. Off until switched on: nothing listens before then.
const { EventEmitter } = require('events');
const { createLink, KNOWN_APPS, iconDataUrl } = require('@streamorchard/grapevine');
const { assetUrl } = require('./kick-api');

const APP_ID = 'com.streamorchard.peardrops';
const PUBLISH_MS = 2000; // at most one drops.farming.changed this often
const MIN = 60_000;

/** Kick's own https address for a picture (never pd-img://, which only Pear Drops can open), or undefined. */
const https = (url) => (typeof url === 'string' && url.startsWith('https://') ? url : undefined);
const iso = (t) => (Number.isFinite(t) ? new Date(t).toISOString() : null);
/** An object without its undefined fields: the schema treats a field that's there as one to check. */
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** Pear Drops' farming status as drops.farming's state. */
function farmingState(code, signedIn) {
  if (!signedIn) return 'signed-out';
  return { farming: 'farming', paused: 'paused', done: 'done' }[code] ?? 'waiting';
}

class Connected extends EventEmitter {
  /**
   * @param {object} o
   * @param {{get(): any, set(patch: object): void}} o.store settings, with connectedApps: { [appId]: { enabled } }
   * @param {import('./farmer').Farmer} o.farmer
   * @param {() => {status: string, user: {username: string} | null}} o.auth
   * @param {string} o.version
   * @param {object} [o.keys] where pairing keys are kept (Grapevine's fileKeyStore)
   * @param {object} [o.place] where the sockets are (a private folder for demo mode and tests)
   * @param {string} [o.appDataDir] to tell whether the other apps are installed
   * @param {{add(type: string, data: object): void}} [o.history]
   * @param {(level: string, text: string) => void} [o.log]
   * @param {() => void} [o.show] brings Pear Drops' window to the front (drops.farming.show)
   * @param {typeof KNOWN_APPS} [o.knownApps] the apps it can link with (Grapevine's list; tests add their own)
   * @param {typeof createLink} [o.make]
   */
  constructor({ store, farmer, auth, version, keys, place, appDataDir, history = null, show = () => {}, knownApps = KNOWN_APPS, log = () => {}, make = createLink }) {
    super();
    this.store = store;
    this.farmer = farmer;
    this.auth = auth;
    this.history = history;
    this.knownApps = knownApps;
    this.heard = new Map(); // app id -> { [event]: its last params }, for every capability it provides
    this.running = false;
    this.error = null;
    this.lastKey = null;
    this.lastWhat = null;
    this.lastAt = 0;
    this.timer = null;
    const self = KNOWN_APPS.find((a) => a.id === APP_ID);
    this.link = make({
      app: { id: APP_ID, slug: self.slug, name: self.name, version, summary: self.summary, homepage: self.homepage, download: self.download, icon: self.icon },
      provides: { 'drops.farming': '1.0' },
      uses: { players: '1.0' },
      allowed: (id) => this.enabled(id),
      knownApps,
      keys,
      place,
      appDataDir,
      log,
    });
    this.link.on('event', (from, name, params) => {
      this.heard.set(from, { ...this.heard.get(from), [name]: params });
      this.changed();
    });
    this.link.on('connected', (id) => this.record('link-connected', id, (name) => `Connected to ${name}`));
    this.link.on('disconnected', (id, reason) => {
      this.heard.delete(id);
      this.record('link-disconnected', id, (name) => `Disconnected from ${name}: ${reason}`);
    });
    this.link.on('unpaired', (id) => this.record('link-unpaired', id, (name) => `${name} disconnected: both apps forgot the pairing`));
    this.link.on('change', () => this.changed());
    // A click on another app's farming widget.
    this.link.handle('drops.farming.show', () => {
      show();
      return { shown: true };
    });
  }

  nameOf(id) {
    return this.knownApps.find((a) => a.id === id)?.name ?? id;
  }

  record(type, id, text) {
    this.history?.add(type, { app: id, appName: this.nameOf(id), text: text(this.nameOf(id)) });
    this.changed();
  }

  /** Its Connect switch, under its current id or one it had before a rename. */
  enabled(id) {
    const apps = this.store.get().connectedApps ?? {};
    return apps[id]?.enabled === true || apps[this.link?.currentId(id) ?? id]?.enabled === true;
  }

  anyOn() {
    return Object.values(this.store.get().connectedApps ?? {}).some((a) => a?.enabled === true);
  }

  /** Listens while any switch is on, and not at all otherwise. */
  async sync() {
    try {
      if (this.anyOn() && !this.running) {
        await this.link.start();
        this.running = true;
        this.error = null;
      } else if (!this.anyOn() && this.running) {
        this.running = false;
        await this.link.stop();
      }
    } catch (err) {
      this.error = err.message;
    }
    if (this.running) this.link.refresh();
    this.changed();
  }

  async setEnabled(id, on) {
    if (!this.knownApps.some((a) => a.id === id) || id === APP_ID) return;
    const apps = { ...(this.store.get().connectedApps ?? {}) };
    apps[id] = { ...apps[id], enabled: !!on };
    this.store.set({ connectedApps: apps });
    await this.sync();
  }

  /** Disconnect on the card: both apps forget the pairing, and the switch goes off. */
  async disconnect(id) {
    await this.link.disconnect(id);
    this.history?.add('link-unpaired', { app: id, appName: this.nameOf(id), text: `Disconnected from ${this.nameOf(id)}: both apps forgot the pairing` });
    await this.setEnabled(id, false);
  }

  pairAgain(id) {
    this.link.pairAgain(id);
  }

  /**
   * What Pear Drops is farming right now, as drops.farming's fields: enough for another app to
   * show it (a top-bar widget, say), with the stream, the drop's picture and every reward's state.
   */
  farming(now = Date.now()) {
    const a = this.auth();
    const signedIn = a.status === 'signed-in';
    const state = farmingState(this.farmer.status?.code, signedIn);
    const cur = this.farmer.current;
    const account = signedIn && a.user?.username ? { platform: 'kick', user: a.user.username } : null;
    if (state !== 'farming' || !cur) return { state, account, channel: null, drop: null };
    const channel = compact({ platform: 'kick', slug: cur.slug, name: cur.username || undefined, avatar: https(cur.avatar) });
    const stream = compact({ title: cur.title ? String(cur.title).slice(0, 300) : undefined, viewers: Number.isInteger(cur.viewers) ? cur.viewers : undefined });
    const c = this.farmer.model.campaigns.find((x) => x.id === cur.campaignIds?.[0]);
    if (!c) return { state, account, channel, stream, drop: null };
    const raw = this.farmer.rawCampaigns?.find((x) => x.id === c.id);
    const rawImage = (id) => https(assetUrl(raw?.rewards?.find((r) => r.id === id)?.image_url));
    const units = c.units ?? 0;
    const f = this.farmer.forecast?.()[c.id];
    // Minutes earned a minute, as Pear Drops sees it; none when it's stalled.
    const rate = f && f.rate >= 0.05 ? f.rate : null;
    const at = (required) => (rate ? iso(now + ((required - units) / rate) * MIN) : null);
    const tracked = c.rewards.filter((r) => r.tracked !== false).sort((x, y) => x.required - y.required);
    const items = tracked.slice(0, 20).map((r) => {
      const state = r.claimed ? 'claimed' : r.ready ? 'ready' : 'locked';
      return compact({ name: r.name, image: rawImage(r.id), required: r.required, state, ...(state === 'locked' ? { unlocksAt: at(r.required) } : {}) });
    });
    const total = c.targetUnits || Math.max(0, ...tracked.map((r) => r.required ?? 0));
    const next = c.next ? compact({ name: c.next.name, image: rawImage(c.next.id), required: c.next.required, unlocksAt: at(c.next.required) }) : null;
    const endsAt = Date.parse(c.endsAt);
    return {
      state,
      account,
      channel,
      stream,
      drop: compact({
        campaign: c.name,
        category: cur.categoryName ?? '',
        progress: { done: units, total, unit: 'minutes' },
        image: https(raw?.category?.image_url) ?? https(raw?.category?.banner_image_url),
        endsAt: Number.isFinite(endsAt) ? iso(endsAt) : undefined,
        rewards: { claimed: tracked.filter((r) => r.claimed).length, total: tracked.length, items },
        next,
        doneAt: at(total),
      }),
    };
  }

  /**
   * Tells the other apps when what's farmed changes. A new state, account or stream goes at once
   * (Stream Multiview signs its players out on it); progress alone at most every 2 seconds.
   */
  update(now = Date.now()) {
    const f = this.farming();
    const what = JSON.stringify([f.state, f.account?.user, f.channel?.slug, f.drop?.campaign]);
    const key = JSON.stringify([what, Math.floor(f.drop?.progress.done ?? 0)]);
    if (key === this.lastKey) return;
    const urgent = what !== this.lastWhat;
    if (this.timer && !urgent) return;
    clearTimeout(this.timer);
    this.timer = null;
    const go = () => {
      this.timer = null;
      const latest = this.farming();
      this.lastWhat = JSON.stringify([latest.state, latest.account?.user, latest.channel?.slug, latest.drop?.campaign]);
      this.lastKey = JSON.stringify([this.lastWhat, Math.floor(latest.drop?.progress.done ?? 0)]);
      this.lastAt = Date.now();
      this.link.publish('drops.farming.changed', latest);
    };
    const wait = urgent ? 0 : Math.max(0, this.lastAt + PUBLISH_MS - now);
    if (wait === 0) return go();
    this.timer = setTimeout(go, wait);
    this.timer.unref?.();
  }

  /** For the Settings card and the credit banner. Logos come separately (icons()), once. */
  state() {
    return {
      running: this.running,
      error: this.error,
      // Each app's card: what it is, what the two share (shares), and the last of each event it sent (heard).
      peers: this.link.peers().map(({ icon: _icon, ...p }) => ({ ...p, heard: this.heard.get(p.id) ?? {} })),
    };
  }

  /** Every known app's logo, as a data URL, by id. */
  icons() {
    this.icons_ ??= Object.fromEntries(this.knownApps.filter((a) => a.id !== APP_ID).map((a) => [a.id, iconDataUrl(a.icon)]));
    return this.icons_;
  }

  changed() {
    this.emit('change');
  }

  async stop() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.running) return;
    this.running = false;
    await this.link.stop().catch(() => {});
  }
}

module.exports = { Connected, farmingState, APP_ID };
