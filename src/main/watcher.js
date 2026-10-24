const { app, BrowserWindow, ipcMain: electronIpc, webContents: allContents } = require('electron');
const { EventEmitter } = require('events');
const path = require('path');
const { PARTITION, KICK } = require('./kick-api');
const { devEnv } = require('./guard');
const { openLink } = require('./security');

// Capture mode (trailer, screenshots): the player (and in light mode its chat) render offscreen
// and their frames are mirrored into the main window, so a recording of that window includes them.
const MIRROR = !!devEnv({ packaged: !!app?.isPackaged })('PD_MIRROR_PLAYER');

// Two ways to show the stream in the docked panel. Both run Kick's own player code,
// which sends the watch-time events that earn drops:
//   light: Kick's embed player (player.kick.com) with the popout chat under it, the
//          way Stream Multiview shows Kick. Much lighter than the full site.
//   full:  the whole kick.com channel page (player and chat in one).
const URLS = {
  player: (slug) => `https://player.kick.com/${encodeURIComponent(slug)}?autoplay=true&muted=false`,
  chat: (slug) => `${KICK}/popout/${encodeURIComponent(slug)}/chat`,
  page: (slug) => `${KICK}/${encodeURIComponent(slug)}`,
};

// kick.com pages with a one-word address that aren't channels.
const KICK_PAGES = new Set(['browse', 'categories', 'category', 'following', 'search', 'dashboard', 'settings', 'subscriptions', 'terms-of-service', 'privacy-policy', 'community-guidelines', 'dmca-policy']);

/** The channel a Kick stream page belongs to (its embed, popout chat or channel page), or null. */
function streamChannel(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const kick = /(^|\.)kick\.com$/.test(u.hostname);
    if (u.hostname === 'player.kick.com') return parts.length === 1 || (parts.length === 2 && parts[1] === 'offline') ? parts[0] : null;
    if (kick && parts.length === 3 && parts[0] === 'popout' && parts[2] === 'chat') return parts[1];
    if (kick && u.hostname !== 'player.kick.com' && parts.length === 1 && /^[\w-]{3,25}$/.test(parts[0]) && !KICK_PAGES.has(parts[0].toLowerCase())) return parts[0];
    return null;
  } catch {
    return null;
  }
}

/** Whether this is the embedded player's "offline" screen, where it goes once a stream ends. */
function playerOffline(url) {
  try {
    const u = new URL(url);
    return u.hostname === 'player.kick.com' && /^\/[^/]+\/offline\/?$/.test(u.pathname);
  } catch {
    return false;
  }
}

/** Kick's embedded player: none of its addresses are links to open in the browser. */
function isPlayer(url) {
  try {
    return new URL(url).hostname === 'player.kick.com';
  } catch {
    return false;
  }
}

/**
 * What one of Kick's realtime events (on the chat's or channel page's socket) says about the
 * stream, or null. Kick doesn't document these, so a match only makes the app check with Kick
 * straight away; the check decides.
 */
function realtimeHint({ event, target } = {}) {
  const name = String(event ?? '').split('\\').pop();
  if (/StopStream|StreamEnd|LivestreamEnd|Offline/i.test(name)) return { kind: 'ended', text: 'Kick said the stream stopped' };
  if (/Raid|Host|MoveTo/i.test(name)) return { kind: 'raid', text: target ? `Kick said the stream is raiding ${target}` : 'Kick said the stream is raiding' };
  if (/LivestreamUpdated|Categor/i.test(name)) return { kind: 'changed', text: 'Kick said the stream changed' };
  return null;
}

/** Whether two addresses are the same page, ignoring the query, hash and a trailing slash. */
function samePage(a, b) {
  try {
    const [x, y] = [new URL(a), new URL(b)];
    const p = (u) => u.pathname.replace(/\/+$/, '').toLowerCase();
    return x.origin === y.origin && p(x) === p(y);
  } catch {
    return false;
  }
}

// The full page: Kick's own top bar (logo, follows, search, profile) isn't needed in
// the panel, so hide it and give its height back to the player.
const PAGE_CSS = `
  :root, body { --navbar-height: 0px !important; }
  nav.z-navbar, nav[class*="z-navbar"] { display: none !important; }
`;
// The popout chat opens a user's card (click a name) to the left of the chat, as on
// kick.com, which is off the panel's edge here: keep it inside (from Stream Multiview).
const CHAT_CSS = `
  #user-identity { left: 0 !important; right: auto !important; width: min(356px, 100vw) !important;
    max-height: 100vh !important; overflow-y: auto !important; }
`;
const ZOOM = { page: 0.8, player: 1, chat: 0.9 };

/**
 * Hosts the stream (and chat) docked inside the main window. Kick's own player code sends the
 * watch-time events; this class only loads the pages, keeps their audio muted at the window level
 * and reports what the player is doing.
 *
 * The pages are <webview>s in the app's own page (as Stream Multiview shows streams), so the
 * page's pop-ups (the daily reward's card, Settings) sit over the stream without hiding it. The
 * page makes them from `spec` (which, and their session), main.js has each one checked as it's
 * attached (allowAttach: Kick's preload, sandboxed, never throttled), and the page then hands its
 * contents over (attach). In capture mode they're offscreen windows mirrored into the page.
 */
class Watcher extends EventEmitter {
  /**
   * @param {() => BrowserWindow} getWindow the main window
   * @param {() => object} getSettings
   * @param {{ ipcMain?: object, contents?: { fromId: (id: number) => object } }} [electron] Electron's, or a test's stand-ins
   */
  constructor(getWindow, getSettings, { ipcMain = electronIpc, contents = allContents } = {}) {
    super();
    this.getWindow = getWindow;
    this.getSettings = getSettings;
    this.contents = contents;
    this.view = null; // the player (light) or the whole channel page (full): { webContents }
    this.chatView = null; // the popout chat (light mode only)
    this.mode = null;
    this.bounds = null;
    this.spec = null; // the <webview>s the page should have: { gen, mode, chat, partition }
    this.gen = 0;
    this.reset(null);

    ipcMain.on('watch:event', (event, msg) => {
      const fromPlayer = this.view && event.sender === this.view.webContents;
      // The popout chat only reports Kick's realtime events (it hears the channel's, the player doesn't).
      const fromChat = this.chatView && event.sender === this.chatView.webContents && msg?.kind === 'realtime';
      if (fromPlayer || fromChat) this.handlePageMessage(msg);
    });
    // The player page asks for the quality to start at before Kick's code runs.
    ipcMain.on('watch:quality', (event) => {
      const ours = [this.view, this.chatView].some((v) => v && event.sender === v.webContents);
      const q = ours ? this.getSettings().playerQuality : null;
      event.returnValue = typeof q === 'number' ? q : null;
    });
  }

  get settingsMode() {
    return this.getSettings().playerMode === 'full' ? 'full' : 'light';
  }

  get showChat() {
    return this.mode === 'light' && this.getSettings().showChat !== false;
  }

  reset(slug) {
    this.slug = slug;
    this.status = {
      slug,
      mode: this.mode,
      loadedAt: slug ? Date.now() : null,
      eventsSent: 0,
      handshakes: 0,
      lastEventAt: null,
      video: null,
      lastVideoAt: null,
      lastAdvanceAt: slug ? Date.now() : null,
    };
  }

  // ------------------------------------------------------------------ views

  ensureViews() {
    const mode = this.settingsMode;
    if (this.mode !== mode) this.destroyViews();
    this.mode = mode;
    if (MIRROR) {
      if (!this.view || this.view.webContents.isDestroyed()) this.view = this.createMirror('player');
      if (mode === 'light' && (!this.chatView || this.chatView.webContents.isDestroyed())) this.chatView = this.createMirror('chat');
    } else if (!this.spec) {
      this.gen += 1;
      this.spec = { gen: this.gen, mode, chat: mode === 'light', partition: PARTITION };
      this.sendSpec();
    }
    this.applyBounds();
    return this.view;
  }

  /** Tells the page which <webview>s to have (none: null). */
  sendSpec() {
    const win = this.getWindow();
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('player:spec', this.spec);
  }

  /**
   * A <webview> the page is about to attach (main.js's will-attach-webview): only the ones the
   * spec asks for, on Kick's session, starting blank. Each gets its role's preload, sandboxed and
   * never throttled (it plays while out of sight), whatever the page asked for. -> allowed
   */
  allowAttach(webPreferences, params) {
    const role = { 'about:blank#player': 'player', 'about:blank#chat': 'chat' }[params?.src];
    if (MIRROR || !this.spec || !role || (role === 'chat' && !this.spec.chat) || params.partition !== PARTITION) return false;
    for (const key of Object.keys(webPreferences)) delete webPreferences[key];
    Object.assign(webPreferences, {
      partition: PARTITION,
      preload: path.join(__dirname, '..', 'preload', role === 'chat' ? 'chat.js' : 'watch.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false,
    });
    params.src = 'about:blank';
    return true;
  }

  /**
   * The page attached the <webview> for `role` (of spec `gen`): its contents, by id. Only a
   * webview of the main window's own page, of the current spec. -> taken
   */
  attach(role, gen, id) {
    if (MIRROR || !this.spec || gen !== this.spec.gen || !['player', 'chat'].includes(role) || (role === 'chat' && !this.spec.chat)) return false;
    const wc = this.contents.fromId(Number(id));
    const host = this.getWindow()?.webContents;
    if (!wc || wc.isDestroyed() || wc.getType() !== 'webview' || !host || wc.hostWebContents !== host) return false;
    const key = role === 'chat' ? 'chatView' : 'view';
    if (this[key]?.webContents === wc) return true;
    this.wire(wc, role);
    this[key] = { webContents: wc };
    wc.once('destroyed', () => {
      if (this[key]?.webContents === wc) this[key] = null;
    });
    if (this.slug) {
      if (role === 'player') this.load('player');
      else if (this.showChat) this.load('chat');
    }
    return true;
  }

  /** What every page of the stream gets: muted, links to the browser, staying on the stream, crash reports. */
  wire(wc, role) {
    wc.setAudioMuted(true);
    // Links from Kick's page open in the browser: http(s) only, and just after you clicked in it.
    const open = (url) => openLink(url, { from: wc });
    wc.setWindowOpenHandler(({ url }) => {
      open(url);
      return { action: 'deny' };
    });
    const css = role === 'chat' ? CHAT_CSS : this.mode === 'full' ? PAGE_CSS : '';
    if (css) wc.on('dom-ready', () => wc.insertCSS(css).catch(() => {}));
    // The page's own address, so a page that reloads itself or only rewrites its query or hash
    // (or a page still left over from the previous stream doing so) isn't taken for a link click.
    let at = '';
    wc.on('did-navigate', (_event, url) => (at = url));
    // A raid, or the end of a stream, sends Kick's page on to another channel, or the player to
    // its "offline" screen. That isn't a link to open in the browser: this stream is over (and the
    // chat just goes back to its own).
    const movedOn = (url) => {
      const to = streamChannel(url);
      if (!to) return false;
      const same = to.toLowerCase() === this.slug.toLowerCase();
      const ended = same && role !== 'chat' && playerOffline(url);
      if (same && !ended) return false;
      if (role === 'chat') this.load('chat');
      else this.emit('left', { from: this.slug, to: ended ? null : to });
      return true;
    };
    // Stay on the stream: links that leave it open in the browser instead.
    wc.on('will-navigate', (event, url) => {
      if (!this.slug || this.isStreamUrl(url)) return;
      event.preventDefault();
      if (!movedOn(url) && !samePage(at, url) && !isPlayer(url)) open(url);
    });
    wc.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (!isMainFrame) return;
      const from = at;
      at = url;
      if (!this.slug || this.isStreamUrl(url) || samePage(from, url) || movedOn(url)) return;
      if (!isPlayer(url)) open(url);
      if (wc.navigationHistory?.canGoBack()) wc.navigationHistory.goBack();
      else this.load(role);
    });
    wc.on('did-finish-load', () => {
      wc.setZoomFactor(role === 'chat' ? ZOOM.chat : this.mode === 'full' ? ZOOM.page : ZOOM.player);
      if (role !== 'chat') wc.send('watch:config', { unmutePlayer: this.getSettings().unmutePlayer });
    });
    if (role === 'chat') {
      // A chat that fails just loads again; it doesn't affect drops.
      wc.on('render-process-gone', () => this.slug && setTimeout(() => this.load('chat'), 3000));
    } else {
      wc.on('render-process-gone', (_e, details) => this.slug && this.emit('crashed', { reason: details.reason }));
      wc.on('unresponsive', () => this.slug && this.emit('crashed', { reason: 'page froze' }));
      wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
        // -3 is an aborted load (we navigated away ourselves).
        if (!isMainFrame || code === -3 || !this.slug || url === 'about:blank') return;
        this.emit('crashed', { reason: description || `load error ${code}` });
      });
    }
  }

  destroyViews() {
    if (this.spec) {
      // The page removes its <webview>s, which closes their pages.
      this.spec = null;
      this.sendSpec();
    }
    for (const key of ['view', 'chatView']) {
      const v = this[key];
      if (!v) continue;
      if (MIRROR && !v.webContents.isDestroyed()) v.webContents.close();
      this[key] = null;
    }
  }

  /** Capture mode: the page offscreen, its frames sent to the main window to draw. */
  createMirror(role) {
    const webPreferences = {
      partition: PARTITION,
      preload: path.join(__dirname, '..', 'preload', role === 'chat' ? 'chat.js' : 'watch.js'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      offscreen: true,
    };
    const win = new BrowserWindow({ show: false, width: 420, height: 760, backgroundColor: '#0b0d10', webPreferences });
    win.webContents.setFrameRate(30);
    let last = 0;
    win.webContents.on('paint', (_e, _dirty, image) => {
      const now = Date.now();
      if (now - last < 30) return;
      last = now;
      const target = this.getWindow();
      if (target && !target.isDestroyed() && !target.webContents.isDestroyed() && this.slug) target.webContents.send('player:frame', role, image.toJPEG(85));
    });
    this.wire(win.webContents, role);
    return { webContents: win.webContents, setBounds: ({ width, height }) => win.setContentSize(width, height) };
  }

  /** The stream's own pages (player, popout chat, channel page), not anywhere else on Kick. */
  isStreamUrl(url) {
    try {
      const u = new URL(url);
      if (u.protocol === 'about:') return true;
      const slug = this.slug.toLowerCase();
      const p = u.pathname.replace(/\/+$/, '').toLowerCase();
      if (u.hostname === 'player.kick.com') return p === `/${slug}`;
      if (!/(^|\.)kick\.com$/.test(u.hostname)) return false;
      return p === `/${slug}` || p === `/popout/${slug}/chat`;
    } catch {
      return true;
    }
  }

  // ------------------------------------------------------------------ the player's reports

  handlePageMessage(msg) {
    const now = Date.now();
    if (msg.kind === 'watch-event') {
      this.status.eventsSent += 1;
      this.status.lastEventAt = now;
      this.emit('watch-event', { t: now, channelId: msg.channelId });
    } else if (msg.kind === 'handshake') {
      this.status.handshakes += 1;
    } else if (msg.kind === 'hint') {
      // The video itself ended or failed.
      const text = { 'video-ended': 'The video ended', 'video-error': 'The video failed' }[msg.reason];
      if (text) this.emit('hint', { text });
    } else if (msg.kind === 'realtime') {
      // The daily reward's hour is done (or a level up): main.js asks Kick at once.
      if (/Gamification/i.test(String(msg.event))) return this.emit('gamification', { event: String(msg.event).split('\\').pop() });
      const hint = realtimeHint(msg);
      if (hint && this.slug) this.emit('hint', hint);
      return;
    } else if (msg.kind === 'video') {
      const prev = this.status.video;
      if (msg.video && (!prev || msg.video.currentTime !== prev.currentTime) && !msg.video.paused) {
        this.status.lastAdvanceAt = now;
      }
      this.status.video = msg.video;
      this.status.lastVideoAt = now;
    }
    this.emit('status', this.status);
  }

  // ------------------------------------------------------------------ watching

  load(role) {
    if (!this.slug) return;
    if (role === 'chat') {
      if (this.chatView && !this.chatView.webContents.isDestroyed() && this.showChat) this.chatView.webContents.loadURL(URLS.chat(this.slug)).catch(() => {});
      return;
    }
    // Not attached yet (the page is making it): attach() loads it.
    if (!this.view || this.view.webContents.isDestroyed()) return;
    const url = this.mode === 'full' ? URLS.page(this.slug) : URLS.player(this.slug);
    this.view.webContents.loadURL(url).catch(() => {});
  }

  watch(slug) {
    this.ensureViews();
    this.reset(slug);
    this.load('player');
    if (this.showChat) this.load('chat');
    else if (this.chatView && !this.chatView.webContents.isDestroyed()) this.chatView.webContents.loadURL('about:blank').catch(() => {});
    this.applyBounds();
    this.emit('status', this.status);
  }

  reload() {
    if (!this.slug) return;
    this.watch(this.slug);
  }

  /** The panel mode or chat setting changed: rebuild the views for the current stream. */
  applySettings() {
    if (this.settingsMode !== this.mode || this.slug) {
      if (this.slug) this.watch(this.slug);
      else this.destroyViews();
    }
  }

  stop() {
    this.reset(null);
    for (const v of [this.view, this.chatView]) {
      if (v && !v.webContents.isDestroyed()) v.webContents.loadURL('about:blank').catch(() => {});
    }
    this.emit('status', this.status);
  }

  // ------------------------------------------------------------------ layout

  /** rect: {x, y, width, height} in window DIPs, or null when out of sight. Capture mode sizes its offscreen pages by it. */
  setBounds(rect) {
    this.bounds = rect;
    this.applyBounds();
  }

  applyBounds() {
    // The <webview>s are laid out by the page itself.
    if (!MIRROR || !this.view) return;
    const visible = !!this.bounds && this.bounds.width > 10 && this.bounds.height > 10;
    if (!visible) return;
    const x = Math.round(this.bounds.x);
    const y = Math.round(this.bounds.y);
    const width = Math.round(this.bounds.width);
    const height = Math.round(this.bounds.height);
    if (this.mode !== 'light') {
      this.view.setBounds({ x, y, width, height });
      return;
    }
    // Light: the player at 16:9 on top, the chat filling the rest.
    const playerHeight = Math.min(height, Math.round((width * 9) / 16));
    this.view.setBounds({ x, y, width, height: playerHeight });
    if (this.showChat) this.chatView?.setBounds({ x, y: y + playerHeight, width, height: Math.max(0, height - playerHeight) });
  }

  openDevTools() {
    this.view?.webContents.openDevTools({ mode: 'detach' });
  }
}

module.exports = { Watcher, URLS, samePage, streamChannel, playerOffline, isPlayer, realtimeHint };
