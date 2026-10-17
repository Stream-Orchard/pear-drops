const { WebContentsView, BrowserWindow, ipcMain, shell } = require('electron');
const { EventEmitter } = require('events');
const path = require('path');
const { PARTITION, KICK } = require('./kick-api');

// Capture mode (trailer, screenshots): the player (and in light mode its chat) render offscreen
// and their frames are mirrored into the main window, so a recording of that window includes them.
const MIRROR = !!process.env.PD_MIRROR_PLAYER;

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
 * Hosts the stream (and chat) in views docked inside the main window. Kick's own
 * player code sends the watch-time events; this class only loads the pages, keeps
 * their audio muted at the window level and reports what the player is doing.
 */
class Watcher extends EventEmitter {
  constructor(getWindow, getSettings) {
    super();
    this.getWindow = getWindow;
    this.getSettings = getSettings;
    this.view = null; // the player (light) or the whole channel page (full)
    this.chatView = null; // the popout chat (light mode only)
    this.mode = null;
    this.bounds = null;
    this.suspended = false;
    this.reset(null);

    ipcMain.on('watch:event', (event, msg) => {
      if (!this.view || event.sender !== this.view.webContents) return;
      this.handlePageMessage(msg);
    });
    // The player page asks for the quality to start at before Kick's code runs.
    ipcMain.on('watch:quality', (event) => {
      const q = this.getSettings().playerQuality;
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
    if (!this.view || this.view.webContents.isDestroyed()) this.view = this.createView('player');
    if (mode === 'light' && (!this.chatView || this.chatView.webContents.isDestroyed())) this.chatView = this.createView('chat');
    this.applyBounds();
    return this.view;
  }

  createView(role) {
    const webPreferences = {
      partition: PARTITION,
      preload: path.join(__dirname, '..', 'preload', role === 'chat' ? 'chat.js' : 'watch.js'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    };
    const view = MIRROR ? this.createMirror(webPreferences, role) : new WebContentsView({ webPreferences });
    view.setBackgroundColor('#0b0d10');
    const wc = view.webContents;
    wc.setAudioMuted(true);
    wc.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
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
      if (!movedOn(url) && !samePage(at, url) && !isPlayer(url)) shell.openExternal(url);
    });
    wc.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (!isMainFrame) return;
      const from = at;
      at = url;
      if (!this.slug || this.isStreamUrl(url) || samePage(from, url) || movedOn(url)) return;
      if (!isPlayer(url)) shell.openExternal(url);
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
    if (!MIRROR) this.getWindow()?.contentView.addChildView(view);
    return view;
  }

  destroyViews() {
    for (const key of ['view', 'chatView']) {
      const v = this[key];
      if (!v) continue;
      try {
        this.getWindow()?.contentView.removeChildView(v);
      } catch {}
      if (!v.webContents.isDestroyed()) v.webContents.close();
      this[key] = null;
    }
  }

  createMirror(webPreferences, role) {
    const win = new BrowserWindow({ show: false, width: 420, height: 760, webPreferences: { ...webPreferences, offscreen: true } });
    win.webContents.setFrameRate(30);
    let last = 0;
    win.webContents.on('paint', (_e, _dirty, image) => {
      const now = Date.now();
      if (now - last < 30) return;
      last = now;
      const target = this.getWindow();
      if (target && !target.isDestroyed() && !target.webContents.isDestroyed() && this.slug) target.webContents.send('player:frame', role, image.toJPEG(85));
    });
    return {
      webContents: win.webContents,
      setBackgroundColor: (c) => win.setBackgroundColor(c),
      setVisible: () => {},
      setBounds: ({ width, height }) => win.setContentSize(width, height),
    };
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

  /** rect: {x, y, width, height} in window DIPs, or null to hide. */
  setBounds(rect) {
    this.bounds = rect;
    this.applyBounds();
  }

  /** Temporarily hide the views, e.g. while a modal is open in the main UI. */
  setSuspended(value) {
    this.suspended = value;
    this.applyBounds();
  }

  applyBounds() {
    if (!this.view) return;
    const visible = !!this.bounds && !this.suspended && this.bounds.width > 10 && this.bounds.height > 10;
    this.view.setVisible(visible);
    this.chatView?.setVisible(visible && this.showChat);
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

module.exports = { Watcher, URLS, samePage, streamChannel, playerOffline, isPlayer };
