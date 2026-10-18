// Connected apps (Settings › Connected apps): other StreamOrchard apps on this computer, linked
// through Grapevine (@streamorchard/grapevine). Pear Drops tells them what it's farming
// (drops.farming), so Stream Multiview can sign its Kick players out and leave the credit here,
// and hears whether those players are signed in (players), so the credit banner can say when
// they're what's taking it. Off until switched on: nothing listens before then.
const { EventEmitter } = require('events');
const { createLink, KNOWN_APPS, iconDataUrl } = require('@streamorchard/grapevine');

const APP_ID = 'com.streamorchard.peardrops';
const PUBLISH_MS = 2000; // at most one drops.farming.changed this often

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
   * @param {typeof createLink} [o.make]
   */
  constructor({ store, farmer, auth, version, keys, place, appDataDir, history = null, log = () => {}, make = createLink }) {
    super();
    this.store = store;
    this.farmer = farmer;
    this.auth = auth;
    this.history = history;
    this.players = new Map(); // app id -> its last players.changed
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
      keys,
      place,
      appDataDir,
      log,
    });
    this.link.on('event', (from, name, params) => {
      if (name !== 'players.changed') return;
      this.players.set(from, params);
      this.changed();
    });
    this.link.on('connected', (id) => this.record('link-connected', id, (name) => `Connected to ${name}`));
    this.link.on('disconnected', (id, reason) => {
      this.players.delete(id);
      this.record('link-disconnected', id, (name) => `Disconnected from ${name}: ${reason}`);
    });
    this.link.on('unpaired', (id) => this.record('link-unpaired', id, (name) => `${name} disconnected: both apps forgot the pairing`));
    this.link.on('change', () => this.changed());
  }

  nameOf(id) {
    return KNOWN_APPS.find((a) => a.id === id)?.name ?? id;
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
    if (!KNOWN_APPS.some((a) => a.id === id) || id === APP_ID) return;
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

  /** What Pear Drops is farming right now, as drops.farming's fields. */
  farming() {
    const a = this.auth();
    const signedIn = a.status === 'signed-in';
    const state = farmingState(this.farmer.status?.code, signedIn);
    const cur = this.farmer.current;
    const account = signedIn && a.user?.username ? { platform: 'kick', user: a.user.username } : null;
    if (state !== 'farming' || !cur) return { state, account, channel: null, drop: null };
    const c = this.farmer.model.campaigns.find((x) => x.id === cur.campaignIds?.[0]);
    const total = c ? c.targetUnits || Math.max(0, ...c.rewards.map((r) => r.required ?? 0)) : 0;
    return {
      state,
      account,
      channel: { platform: 'kick', slug: cur.slug, ...(cur.username ? { name: cur.username } : {}) },
      drop: c ? { campaign: c.name, category: cur.categoryName ?? '', progress: { done: c.units ?? 0, total, unit: 'minutes' } } : null,
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
      peers: this.link.peers().map(({ icon: _icon, ...p }) => ({ ...p, kick: this.players.get(p.id)?.platforms?.kick ?? null })),
    };
  }

  /** Every known app's logo, as a data URL, by id. */
  icons() {
    this.icons_ ??= Object.fromEntries(KNOWN_APPS.filter((a) => a.id !== APP_ID).map((a) => [a.id, iconDataUrl(a.icon)]));
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
