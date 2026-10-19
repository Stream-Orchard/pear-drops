const { app, BrowserWindow, ipcMain, shell, session, Notification, powerSaveBlocker, powerMonitor, nativeImage, screen, protocol, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const { KickApi, PARTITION, KICK, assetUrl } = require('./kick-api');
const { DropArchive, SCHEME: IMAGE_SCHEME } = require('./archive');
const { Watcher } = require('./watcher');
const { Farmer } = require('./farmer');
const { Notifier, cleanNotify, systemSettingsUrl } = require('./notifier');
const { Store } = require('./store');
const { setupSecurity, guardContents, keepOnKick, openLink } = require('./security');
const guard = require('./guard');
const { createDemo } = require('./demo');
const { TrayController } = require('./tray');
const { History } = require('./history');
const { openDb, OLD_FILES } = require('./db');
const { Backups, EVERY, KEEP } = require('./backups');
const { Updates, parseChangelog } = require('./updates');
const { Connected } = require('./connected');
const { fileKeyStore } = require('@streamorchard/grapevine');

// Errors are logged, never shown as Electron's own error dialog.
process.on('uncaughtException', (err) => console.error('Uncaught exception:', err));
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));

// The PD_ settings (demo mode, tests, dev copies) only count in copies run from source.
const env = guard.devEnv({ packaged: app.isPackaged });
// An installed copy doesn't let another program drive or inspect it.
const debugging = guard.debugSwitch({ packaged: app.isPackaged, hasSwitch: (s) => app.commandLine.hasSwitch(s) });
if (debugging) {
  console.error(`Pear Drops doesn't start with --${debugging}`);
  app.exit(1);
}

const DEMO = !!env('PD_DEMO');
const HIDDEN = !!env('PD_TEST_HIDDEN');
const demo = DEMO ? createDemo() : null;
// Demo mode (and so every test) never opens the real browser: its channels are made up.
// Links it would open are kept in global.pdOpened instead, for tests to check.
if (DEMO) {
  global.pdOpened = [];
  shell.openExternal = async (url) => {
    global.pdOpened.push(String(url));
  };
}

// Dev copies and tests run against their own data folder.
if (env('PD_DEV_DATA')) app.setPath('userData', env('PD_DEV_DATA'));

// Keep the hidden/docked player running at full speed, and let it autoplay with
// sound (the window itself is muted, so nothing is audible).
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// Tests: no window ever shows or takes focus, and nothing makes a sound.
if (HIDDEN) app.commandLine.appendSwitch('mute-audio');
// Video captures render at a fixed scale (e.g. 1440×900 at 1.3333 = 1920×1200 frames).
if (env('PD_SCALE')) app.commandLine.appendSwitch('force-device-scale-factor', env('PD_SCALE'));

// The app's stored copies of drop images (see archive.js), shown like any web image.
protocol.registerSchemesAsPrivileged([{ scheme: IMAGE_SCHEME, privileges: { standard: true, secure: true } }]);

// Present as plain Chrome rather than "Electron/x pear-drops/y".
app.userAgentFallback = app.userAgentFallback.replace(/\s(Electron|pear-drops|Pear Drops)\/\S+/g, '');

let mainWindow = null;
let loginWindow = null;
let store, api, watcher, farmer;
let auth = { status: 'checking', user: null };
let powerBlocker = null;
let security = { encryption: 'unknown', setForget: () => {} };
let tray = null;
let db = null; // the app's data: history, drop archive, startup cache, small state (db.js)
let backups = null; // its copies (backups.js)
let history = null;
let archive = null;
let updates = null;
let connected = null; // Settings › Connected apps (connected.js)
let linkDir = null; // where it finds other apps: a folder of its own in demo mode and dev copies
let quitting = false;
/** One of the app's own windows (the dashboard, the tray popover), not a Kick page. */
const isApp = (wc) => [mainWindow, tray?.window].some((w) => w && !w.isDestroyed() && w.webContents === wc);
// What pages may ask for (guard.js), on every session: the app's own, Kick's, and any made later.
app.on('session-created', (ses) => guard.lockSession(ses, isApp));
// The app's own folder (package.json, CHANGELOG.md): the source folder, or inside the installed app.
const APP_ROOT = path.join(__dirname, '..', '..');

function appState() {
  return {
    auth,
    settings: store.get(),
    security: { encryption: security.encryption },
    farm: auth.status === 'signed-in' ? farmer.snapshot() : null,
    connected: connected?.state() ?? null,
    backups: backups?.status() ?? null,
  };
}

/** Sends to a window's page unless it (or its page) is already gone, e.g. while quitting. */
function sendTo(win, channel, payload) {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
  win.webContents.send(channel, payload);
}

function sendState() {
  if (quitting) return;
  const state = appState();
  sendTo(mainWindow, 'state', state);
  if (tray?.window?.isVisible()) sendTo(tray.window, 'state', state);
  updateTray();
}

function updateTray() {
  if (!tray || quitting) return;
  const info = auth.status === 'signed-in' ? farmer.trayInfo() : { tone: 'idle', fraction: 0, title: '', tooltip: 'Pear Drops · signed out' };
  tray.update(info, { showPercent: store.get().trayPercent });
}

function showMain() {
  if (!mainWindow) createMainWindow();
  if (HIDDEN) return mainWindow.showInactive();
  if (process.platform === 'darwin') app.dock.show();
  mainWindow.show();
  mainWindow.focus();
}

function hideToTray() {
  mainWindow?.hide();
  if (process.platform === 'darwin') app.dock.hide();
}

function setAuth(next) {
  auth = { ...auth, ...next };
  connected?.update();
  sendState();
}

// Desktop notifications (Settings › Notifications). Demo mode and tests record them in
// global.pdNotes instead of showing them.
let notifier = null;
function createNotifier() {
  if (DEMO || HIDDEN) global.pdNotes = [];
  notifier = new Notifier({
    Notification,
    getSettings: () => store.get(),
    inFront: () => BrowserWindow.getAllWindows().some((w) => w.isFocused() && w.isVisible()),
    onClick: (view) => {
      showMain();
      if (view) sendTo(mainWindow, 'show-view', view);
    },
    icon: process.platform === 'darwin' ? undefined : path.join(__dirname, '..', 'renderer', 'assets', 'icon.png'),
    record: DEMO || HIDDEN ? (note) => global.pdNotes.push({ ...note, t: Date.now() }) : null,
  });
}

/** What the farmer and the app tell the user, as desktop notifications of each kind. */
function notifyFarming() {
  const send = (kind, title, body, view) => notifier.send(kind, { title, body, view });
  farmer.on('claimed', ({ reward, campaign }) => send('claimed', 'Drop claimed', `${reward} · ${campaign}`));
  farmer.on('ready', (list) => send('ready', list.length > 1 ? `${list.length} drops ready to claim` : 'Drop ready to claim', list.map((x) => `${x.reward} · ${x.campaign}`).join('\n')));
  farmer.on('notice', (n) => {
    if (n.kind === 'ended' || n.kind === 'raid') send('ended', n.kind === 'raid' ? 'Stream raided' : 'Stream ended', `${n.text}. Finding the next one.`, 'history');
    else send('trouble', 'Stream problem', n.text, 'history');
  });
  farmer.on('status-change', ({ code, was, message }) => {
    if (code === 'done' && was !== 'starting') send('done', 'All drops collected', message);
    if (code === 'waiting' && was === 'farming') send('done', 'Nothing to watch right now', 'No live streams for the remaining drops. Pear Drops keeps checking.');
  });
  const startsOn = (t) => new Date(t).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  farmer.on('new-drops', (list) => {
    const soon = list.every((c) => c.startsAt);
    const title = soon ? (list.length > 1 ? `${list.length} drops coming to Kick` : 'Drop coming to Kick') : list.length > 1 ? `${list.length} new drops on Kick` : 'New drop on Kick';
    send('newDrops', title, list.map((c) => `${c.name}${c.category ? ` · ${c.category}` : ''}${c.startsAt ? ` · starts ${startsOn(c.startsAt)}` : ''}`).join('\n'));
  });
}

// Opens maximized the first time, then wherever the user last left it.
function windowState() {
  const saved = store.get().window;
  if (!saved?.bounds) return { maximized: true, bounds: null };
  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    const b = saved.bounds;
    return b.x < a.x + a.width - 100 && b.x + b.width > a.x + 100 && b.y < a.y + a.height - 100 && b.y + b.height > a.y;
  });
  return visible ? saved : { maximized: true, bounds: null };
}

function rememberWindow() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized() || !mainWindow.isVisible()) return;
  const maximized = mainWindow.isMaximized();
  const previous = store.get().window;
  store.set({ window: { maximized, bounds: maximized ? previous?.bounds ?? mainWindow.getNormalBounds() : mainWindow.getBounds() } });
}

function createMainWindow() {
  const saved = windowState();
  mainWindow = new BrowserWindow({
    width: saved.bounds?.width ?? 1480,
    height: saved.bounds?.height ?? 940,
    ...(saved.bounds ? { x: saved.bounds.x, y: saved.bounds.y } : {}),
    minWidth: 1120,
    minHeight: 700,
    title: 'Pear Drops',
    icon: path.join(__dirname, '..', 'renderer', 'assets', 'icon.png'),
    backgroundColor: '#0a0b0d',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 20 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'app.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  // The app's own page plays the stall alert (muted only in tests).
  mainWindow.webContents.setAudioMuted(HIDDEN);
  mainWindow.once('ready-to-show', () => {
    if (HIDDEN) {
      // Tests: painted and drivable, but invisible and never focused. Linux stops drawing a fully
      // transparent window (about one frame a second), so there it's only nearly transparent.
      mainWindow.setOpacity(process.platform === 'linux' ? 0.01 : 0);
      mainWindow.setIgnoreMouseEvents(true);
      mainWindow.showInactive();
      return;
    }
    if (saved.maximized && !env('PD_NO_MAXIMIZE')) mainWindow.maximize();
    mainWindow.show();
  });
  let saveTimer = null;
  const saveSoon = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(rememberWindow, 500);
  };
  ['resize', 'move', 'maximize', 'unmaximize'].forEach((e) => mainWindow.on(e, saveSoon));
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // With tray mode on, closing or minimizing keeps farming in the menu bar / tray.
  mainWindow.on('close', (event) => {
    if (quitting || !store.get().minimizeToTray) return;
    event.preventDefault();
    hideToTray();
  });
  mainWindow.on('minimize', (event) => {
    if (!store.get().minimizeToTray) return;
    event.preventDefault();
    hideToTray();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    // Hidden helper windows (API page, tray popover) would otherwise keep the app alive.
    if (!quitting) app.quit();
  });
}

function startFarming() {
  farmer.start();
  if (powerBlocker === null) powerBlocker = powerSaveBlocker.start('prevent-app-suspension');
}

function stopFarming() {
  farmer.stop();
  if (powerBlocker !== null) {
    powerSaveBlocker.stop(powerBlocker);
    powerBlocker = null;
  }
}

async function checkAuth() {
  // Fast path: a saved login and the last known profile show the dashboard right
  // away; the real check below confirms it (or signs out).
  const last = store.get().lastUser;
  if (auth.status === 'checking' && last && (await api.hasLogin().catch(() => false))) {
    setAuth({ status: 'signed-in', user: last });
    startFarming();
  }
  try {
    const me = await api.me();
    if (me) {
      if (auth.status !== 'signed-in' && auth.status !== 'checking') history?.add('login', { text: `Signed in as ${me.username}` });
      const user = { username: me.username, avatar: me.profilepic ?? me.profile_pic ?? me.profile_picture ?? null, slug: me.streamer_channel?.slug ?? me.username };
      store.set({ lastUser: user });
      setAuth({ status: 'signed-in', user });
      startFarming();
      return true;
    }
  } catch (err) {
    // Kick unreachable (offline at launch): keep a saved login and try again later.
    console.error('Auth check failed', err);
    if (auth.status === 'signed-in') {
      setTimeout(checkAuth, 60_000);
      return true;
    }
  }
  if (auth.status === 'signed-in') stopFarming();
  store.set({ lastUser: null });
  setAuth({ status: 'signed-out', user: null });
  return false;
}

function openLogin() {
  if (DEMO) {
    setAuth({ status: 'signing-in' });
    setTimeout(() => {
      demo.api.loggedIn = true;
      checkAuth();
    }, 1600);
    return;
  }
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus();
    return;
  }
  setAuth({ status: 'signing-in' });
  loginWindow = new BrowserWindow({
    width: 520,
    height: 780,
    parent: mainWindow ?? undefined,
    modal: false,
    title: 'Sign in to Kick',
    backgroundColor: '#0a0b0d',
    webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true },
  });
  loginWindow.webContents.setAudioMuted(true);
  // Sign-in providers (Google, Apple) open as pop-ups in the same Kick session. The window and its
  // pop-ups stay on Kick and those providers: anything else opens in the browser.
  keepOnKick(loginWindow.webContents, () => ({ parent: loginWindow ?? undefined, webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true } }));
  loginWindow.loadURL(`${KICK}/`);

  // Answer Kick's cookie banner first (it can sit under the login dialog, where it
  // can't be clicked), then open Kick's own login dialog for convenience.
  loginWindow.webContents.once('did-finish-load', () => {
    loginWindow?.webContents
      .executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        for (let i = 0; i < 20; i++) {
          const reject = document.querySelector('#onetrust-reject-all-handler');
          if (reject && reject.offsetParent !== null) { reject.click(); break; }
          await wait(250);
        }
        await wait(600);
        const b = [...document.querySelectorAll('button')].find((x) => /^log ?in$/i.test(x.textContent.trim()));
        if (b) b.click();
      })()`)
      .catch(() => {});
  });

  const poll = setInterval(async () => {
    if (!loginWindow || loginWindow.isDestroyed()) return clearInterval(poll);
    if (!(await api.hasLogin())) return;
    const me = await api.me().catch(() => null);
    if (!me) return;
    clearInterval(poll);
    loginWindow.close();
    await checkAuth();
  }, 1500);

  loginWindow.on('closed', () => {
    clearInterval(poll);
    loginWindow = null;
    if (auth.status === 'signing-in') setAuth({ status: 'signed-out' });
  });
}

/** Closes (or blanks) every page using the Kick login, so none of them writes it back while it's wiped. */
function closeKickPages() {
  if (loginWindow && !loginWindow.isDestroyed()) loginWindow.destroy();
  watcher?.destroyViews();
}

async function signOut() {
  history?.add('logout', { text: 'Signed out' });
  store.set({ lastUser: null });
  stopFarming();
  await api.signOut({ closePages: closeKickPages });
  setAuth({ status: 'signed-out', user: null });
}

// Demo mode: the stand-in server credits watch events, and the trailer and tests
// drive the story through global.pdDemo.
function setupDemo() {
  watcher.on('watch-event', () => farmer.current && demo.api.creditWatch(farmer.current.slug));
  let seeded = !env('PD_DEMO_SEED');
  farmer.on('update', () => {
    if (seeded || !farmer.current) return;
    seeded = true;
    demo.seedHistory(farmer, demo.api);
  });
  global.pdDemo = {
    api: demo.api,
    farmer,
    /** One watch event from the player, credited by the stand-in server. */
    credit: async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const before = farmer.stats.eventsSent;
      const wc = watcher.view?.webContents;
      if (wc) await wc.executeJavaScript('window.__demoWatchEvent && window.__demoWatchEvent()').catch(() => {});
      for (let i = 0; i < 40 && farmer.stats.eventsSent === before; i++) await sleep(50);
      // Page not ready yet: credit as the server would have.
      if (farmer.stats.eventsSent === before && farmer.current) demo.api.creditWatch(farmer.current.slug);
      while (farmer.ticking) await sleep(50);
      await farmer.tick();
    },
    /**
     * A stand-in Stream Multiview, linked through Grapevine the way the real one is: it uses
     * drops.farming and says whether its Kick players are signed in. Off with { stop: true }.
     */
    multiview: async ({ signedIn = false, mode = 'auto', open = ['pixelpear', 'moonlitmaple'], installed = true, stop = false } = {}) => {
      const { standInPeer } = require('@streamorchard/grapevine/stand-in-peer');
      await global.pdDemo.multiviewPeer?.stop();
      global.pdDemo.multiviewPeer = null;
      const folder = path.join(app.getPath('userData'), 'demo-apps', 'Stream Multiview');
      if (installed) fs.mkdirSync(folder, { recursive: true });
      else fs.rmSync(folder, { recursive: true, force: true });
      connected.changed();
      if (stop) return false;
      const peer = await standInPeer({
        as: 'com.glowingpear.streammultiview',
        dir: linkDir,
        version: '0.4.0',
        provides: { players: '1.0' },
        uses: { 'drops.farming': '1.0' },
        keys: fileKeyStore(path.join(app.getPath('userData'), 'demo-multiview-keys.json')),
        timing: { pollMs: 300, backoffMs: [200, 500, 1000] },
      });
      const user = auth.user?.username;
      peer.link.publish('players.changed', {
        platforms: { kick: { signedIn, mode, account: user ? { platform: 'kick', user } : null, open: open.map((slug) => ({ platform: 'kick', slug })) } },
      });
      global.pdDemo.multiviewPeer = peer;
      return true;
    },
    /** Another session "takes" the credit: events keep going, credit stops. */
    conflict: (on = true) => {
      demo.api.conflict = on;
    },
    tick: () => farmer.tick(),
    openTray: () => tray.toggle(),
    /** Jump a campaign's progress (e.g. to just past a reward) and refresh. */
    advance: async (campaignId, units) => {
      demo.api.units[campaignId] = units;
      while (farmer.ticking) await new Promise((r) => setTimeout(r, 50));
      await farmer.tick();
    },
    /** Kick stops listing a drop (it ended or was taken down), and re-check. */
    endDrop: async (campaignId) => {
      demo.api.endCampaign(campaignId);
      while (farmer.ticking) await new Promise((r) => setTimeout(r, 50));
      await farmer.tick({ force: true });
    },
    /** Kick lists an ended drop again with a new end date, and re-check. */
    relistDrop: async (campaignId, daysLeft = 2) => {
      demo.api.relistCampaign(campaignId, daysLeft);
      while (farmer.ticking) await new Promise((r) => setTimeout(r, 50));
      await farmer.tick({ force: true });
    },
    /**
     * The stream being watched ends. how: 'video' (the player's video ends), 'kick' (Kick's realtime
     * socket says so, heard by the chat), 'player' (the player goes to its offline screen) or
     * 'quiet' (no sign at all: the next refresh finds it).
     */
    endStream: async (how = 'video') => {
      const slug = farmer.current?.slug;
      if (!slug) return null;
      demo.api.offline.add(slug);
      const run = (wc, js) => wc && !wc.isDestroyed() && wc.executeJavaScript(js).catch(() => {});
      const page = watcher.mode === 'full' ? watcher.view?.webContents : watcher.chatView?.webContents;
      if (how === 'video') run(watcher.view?.webContents, 'window.__demoEnd && window.__demoEnd()');
      if (how === 'kick') run(page, "window.__demoRealtime && window.__demoRealtime('App\\\\Events\\\\StopStreamBroadcast')");
      if (how === 'player') run(watcher.view?.webContents, `location.href = 'https://player.kick.com/${slug}/offline'`);
      return slug;
    },
    /** The stream being watched raids another channel: the player goes there. */
    raid: async (to) => {
      const slug = farmer.current?.slug;
      if (!slug) return null;
      demo.api.offline.add(slug);
      await watcher.view?.webContents.executeJavaScript(`location.href = 'https://player.kick.com/${to}'`).catch(() => {});
      return slug;
    },
    /** The player's picture freezes (or moves again). */
    freeze: (on = true) => watcher.view?.webContents.executeJavaScript(`window.__demoFreeze && window.__demoFreeze(${!!on})`).catch(() => {}),
    /** Take a stand-in channel offline (or back online) and re-check. */
    offline: async (slug, on = true) => {
      on ? demo.api.offline.add(slug) : demo.api.offline.delete(slug);
      farmer.streams.clear();
      await farmer.tick({ force: true });
    },
  };
}

// Who may send the app's messages (guard.js): only its own windows showing their own page. A Kick
// page, a pop-up or a frame never gets an answer, even if it somehow had the app's preload.
const PAGES = { main: path.join(__dirname, '..', 'renderer', 'index.html'), tray: path.join(__dirname, '..', 'renderer', 'tray.html') };
const roleOf = guard.senderRole({ files: PAGES, windows: () => ({ main: mainWindow, tray: tray?.window }) });
const refused = (channel, e) => console.warn(`Refused ${channel} from ${e?.senderFrame?.url || 'a page that is gone'}`);
const mainIpc = guard.guardedIpc(ipcMain, roleOf, ['main'], refused); // everything that changes what the app does
const appIpc = guard.guardedIpc(ipcMain, roleOf, ['main', 'tray'], refused);
const trayIpc = guard.guardedIpc(ipcMain, roleOf, ['tray'], refused);

/** A short id from a page (a campaign, a reward, a category): a string or number, or null. */
const idArg = (v) => ((typeof v === 'string' && v.length > 0 && v.length <= 100) || Number.isSafeInteger(v) ? v : null);
/** Where the docked player goes: four numbers, or null to hide it. */
const rectArg = (r) => (r && typeof r === 'object' && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(r[k])) ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.max(0, Math.round(r.width)), height: Math.max(0, Math.round(r.height)) } : null);

function registerIpc() {
  appIpc.handle('app:getState', () => appState());
  mainIpc.handle('auth:login', () => openLogin());
  mainIpc.handle('history:view', (_e, opts = {}) => {
    const campaignId = typeof opts.campaignId === 'string' ? opts.campaignId : null;
    const view = history.view({
      since: Number(opts.since) || 0,
      campaignId,
      groups: Array.isArray(opts.groups) ? opts.groups.filter((g) => typeof g === 'string') : null,
      text: typeof opts.text === 'string' ? opts.text.slice(0, 100) : '',
      limit: Math.min(1000, Number(opts.limit) || 400),
    });
    // Each drop's details (and stored images) from the archive, for drops Kick no longer lists.
    const drops = {};
    for (const id of new Set([campaignId, ...view.campaigns.map((c) => c.campaignId)])) {
      const info = id && farmer.dropInfo(id);
      if (info) drops[id] = info;
    }
    const local = (url) => archive.img(url);
    for (const e of view.events) if (e.rewardImage) e.rewardImage = local(e.rewardImage);
    for (const c of view.campaigns) for (const r of c.rewards) r.image = local(r.image);
    return { ...view, drops };
  });
  mainIpc.handle('auth:logout', () => signOut());
  mainIpc.handle('farm:pause', (_e, paused) => farmer.setPaused(!!paused));
  mainIpc.handle('farm:refresh', () => farmer.tick({ force: true }));
  mainIpc.handle('farm:skip', () => farmer.skip());
  mainIpc.handle('farm:reload', () => farmer.reloadPlayer());
  mainIpc.handle('farm:watch', (_e, slug, categoryId) => {
    if (typeof slug !== 'string' || !/^[a-z0-9_-]{1,40}$/i.test(slug) || idArg(categoryId) === null) throw new Error('Stream is no longer available');
    return farmer.watchManual(slug, categoryId);
  });
  mainIpc.handle('farm:claim', (_e, campaignId, rewardId) => {
    if (idArg(campaignId) === null || idArg(rewardId) === null) return { error: 'That drop isn’t there any more.' };
    return farmer.claimOne(campaignId, rewardId);
  });
  mainIpc.handle('farm:follow', async (_e, slug, on) => {
    if (typeof slug !== 'string' || !/^[a-z0-9_-]{2,40}$/i.test(slug)) return { error: 'bad' };
    try {
      return await farmer.setFollow(slug, !!on);
    } catch (err) {
      return { error: err.status === 401 || err.status === 403 ? 'login' : 'failed', status: err.status ?? 0 };
    }
  });
  mainIpc.handle('settings:set', (_e, patch) => {
    const allowed = ['stallMinutes', 'refreshSeconds', 'autoClaim', 'includeGameDrops', 'unmutePlayer', 'playerOpen', 'categoryOrder', 'disabledCategories', 'forgetOnQuit', 'alertOnStall', 'repeatAlert', 'alertRepeatSeconds', 'minimizeToTray', 'trayPercent', 'prioritizeExpiring', 'queueMode', 'campaignsMinutes', 'streamsMinutes', 'followedMinutes', 'playerMode', 'showChat', 'playerQuality', 'font', 'smartRarity', 'smartHopMinutes', 'notify', 'notifyAway', 'backupEvery', 'backupKeep'];
    const clean = Object.fromEntries(Object.entries(patch ?? {}).filter(([k]) => allowed.includes(k)));
    if (clean.stallMinutes !== undefined) clean.stallMinutes = Math.min(120, Math.max(5, Number(clean.stallMinutes) || 20));
    if (clean.refreshSeconds !== undefined) clean.refreshSeconds = Math.min(300, Math.max(30, Number(clean.refreshSeconds) || 60));
    const clamp = (key, min, max, fallback) => {
      if (clean[key] !== undefined) clean[key] = Math.min(max, Math.max(min, Number(clean[key]) || fallback));
    };
    clamp('campaignsMinutes', 2, 60, 10);
    clamp('streamsMinutes', 1, 15, 3);
    clamp('followedMinutes', 5, 60, 15);
    if (clean.alertRepeatSeconds !== undefined && ![15, 30, 60].includes(Number(clean.alertRepeatSeconds))) delete clean.alertRepeatSeconds;
    else if (clean.alertRepeatSeconds !== undefined) clean.alertRepeatSeconds = Number(clean.alertRepeatSeconds);
    if (clean.playerMode !== undefined && !['light', 'full'].includes(clean.playerMode)) delete clean.playerMode;
    if (clean.font !== undefined && !['system', 'bundled'].includes(clean.font)) delete clean.font;
    if (clean.smartRarity !== undefined && !['off', 'some', 'strong'].includes(clean.smartRarity)) delete clean.smartRarity;
    if (clean.smartHopMinutes !== undefined && ![15, 30, 60, 120].includes(Number(clean.smartHopMinutes))) delete clean.smartHopMinutes;
    else if (clean.smartHopMinutes !== undefined) clean.smartHopMinutes = Number(clean.smartHopMinutes);
    if (clean.backupEvery !== undefined && !Object.keys(EVERY).includes(clean.backupEvery)) delete clean.backupEvery;
    if (clean.backupKeep !== undefined && !KEEP.includes(Number(clean.backupKeep))) delete clean.backupKeep;
    else if (clean.backupKeep !== undefined) clean.backupKeep = Number(clean.backupKeep);
    if (clean.notify !== undefined) clean.notify = cleanNotify(clean.notify);
    if (clean.notifyAway !== undefined) clean.notifyAway = clean.notifyAway === true;
    if (clean.queueMode !== undefined && !['manual', 'smart'].includes(clean.queueMode)) delete clean.queueMode;
    if (clean.playerQuality === 'auto') clean.playerQuality = null;
    if (clean.playerQuality !== undefined && clean.playerQuality !== null) clean.playerQuality = Number(clean.playerQuality);
    if (clean.playerQuality !== undefined && clean.playerQuality !== null && ![160, 360, 480, 720, 1080].includes(clean.playerQuality)) delete clean.playerQuality;
    store.set(clean);
    if ('forgetOnQuit' in clean) security.setForget(clean.forgetOnQuit);
    if ('playerMode' in clean || 'showChat' in clean || 'playerQuality' in clean) watcher.applySettings();
    if ('backupKeep' in clean) backups.rotate();
    if ('backupEvery' in clean) backups.check();
    if (['includeGameDrops', 'categoryOrder', 'disabledCategories', 'queueMode', 'smartRarity', 'smartHopMinutes'].some((k) => k in clean)) {
      farmer.buildModel();
      farmer.tick();
    }
    sendState();
  });
  // Settings › Connected apps.
  mainIpc.handle('connected:set', (_e, id, on) => connected.setEnabled(String(id).slice(0, 200), !!on));
  mainIpc.handle('connected:disconnect', (_e, id) => connected.disconnect(String(id).slice(0, 200)));
  mainIpc.handle('connected:pair-again', (_e, id) => connected.pairAgain(String(id).slice(0, 200)));
  mainIpc.handle('connected:allow', (_e, id) => connected.allowPairing(String(id).slice(0, 200)));
  mainIpc.handle('connected:test', (_e, id) => connected.test(String(id).slice(0, 200)));
  mainIpc.handle('connected:icons', () => connected.icons());
  mainIpc.handle('connected:activity', (_e, id, opts) => {
    const o = opts && typeof opts === 'object' ? opts : {};
    return connected.activityPage(String(id).slice(0, 200), {
      filter: ['all', 'out', 'in', 'problems'].includes(o.filter) ? o.filter : 'all',
      before: Number.isInteger(o.before) ? o.before : null,
      limit: Math.min(50, Math.max(1, Number(o.limit) || 10)),
    });
  });
  mainIpc.handle('notify:test', () => notifier.test());
  // Settings › Privacy: back up now, and show where the copies are.
  mainIpc.handle('backups:run', async () => !!(await backups.run()));
  mainIpc.handle('backups:show', () => {
    fs.mkdirSync(backups.dir, { recursive: true });
    if (DEMO) global.pdOpened.push(backups.dir);
    else shell.openPath(backups.dir);
  });
  mainIpc.handle('notify:system-settings', () => {
    const url = systemSettingsUrl();
    if (url && !DEMO) shell.openExternal(url);
    return !!url;
  });
  mainIpc.handle('player:bounds', (_e, rect) => watcher.setBounds(rectArg(rect)));
  mainIpc.handle('player:suspend', (_e, value) => watcher.setSuspended(!!value));
  mainIpc.handle('player:devtools', () => watcher.openDevTools());
  mainIpc.handle('open:external', (_e, url) => {
    if (typeof url !== 'string') return;
    if (/^https:\/\/(www\.)?kick\.com\//.test(url)) openLink(url);
    // A drop's About page or a connect link, exactly as Kick gave them.
    else if (farmer.knownLinks().has(url)) openLink(url);
    // Links in release notes, and the release page.
    else if (/^https:\/\/github\.com\//.test(url)) openLink(url);
  });

  mainIpc.handle('update:status', () => updates.status());
  mainIpc.handle('update:check', () => updates.check());
  mainIpc.handle('update:install', () => updates.install());
  mainIpc.handle('update:restart', () => updates.restart());
  mainIpc.handle('update:settings', (_e, patch) => updates.settings(patch && typeof patch === 'object' ? patch : {}));
  mainIpc.handle('update:use-dmg', () => updates.useDmg());
  mainIpc.handle('update:open-page', () => openLink(updates.status().page || `https://github.com/${updates.status().repo}/releases/latest`));
  // Mac: System Settings > Privacy & Security > App Management, where the app may update itself.
  mainIpc.handle('update:privacy-settings', () => shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AppBundles'));
  mainIpc.handle('update:seen', () => updates.dismissJustUpdated());
  // Links in release notes (already limited to https by the page).
  mainIpc.handle('update:open-link', (_e, url) => /^https:\/\//.test(String(url)) && openLink(String(url)));
  mainIpc.handle('update:changelog', () => {
    try {
      return parseChangelog(fs.readFileSync(path.join(APP_ROOT, 'CHANGELOG.md'), 'utf8'));
    } catch {
      return [];
    }
  });
}

function setupUpdates() {
  const { execFile, spawn } = require('child_process');
  const { net } = require('electron');
  // Tests point the updater at a stand-in GitHub and a copy of the app folder.
  const appRoot = env('PD_UPDATE_APP_ROOT') || APP_ROOT;
  require('./updater').useServer({ api: env('PD_UPDATE_API'), raw: env('PD_UPDATE_RAW') });
  // The repository comes from the folder being updated, so a test's stand-in folder brings its own.
  let pkgRepo = '';
  let formerRepos = [];
  try {
    const pkg = require(path.join(appRoot, 'package.json'));
    pkgRepo = String(pkg.updateRepo || '');
    if (Array.isArray(pkg.formerUpdateRepos)) formerRepos = pkg.formerUpdateRepos.map(String);
  } catch {}
  updates = new Updates({
    version: app.getVersion(),
    installed: app.isPackaged,
    platform: process.platform,
    appRoot,
    dataDir: app.getPath('userData'),
    saved: db.slot('updates'),
    tempDir: app.getPath('temp'),
    downloadsDir: app.getPath('downloads'),
    execPath: process.execPath,
    pid: process.pid,
    pkgRepo,
    formerRepos,
    // A git checkout or a dev copy only checks: installing would overwrite the work in progress.
    devCopy: !app.isPackaged && !env('PD_UPDATE_APP_ROOT') && (fs.existsSync(path.join(APP_ROOT, '.git')) || !!env('PD_DEV_DATA')),
    fetch: (url, opts) => net.fetch(url, opts),
    runTool: (cmd, args) => new Promise((res, rej) => execFile(cmd, args, { maxBuffer: 1 << 20 }, (e, out, err) => (e ? rej(e) : res(`${out}\n${err}`)))),
    spawn: (cmd, args) => spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref(),
    openExternal: (url) => openLink(url),
    openPath: (file) => shell.openPath(file),
    quit: () => app.quit(),
    relaunch: () => {
      app.relaunch();
      app.exit(0);
    },
  }).load();
  updates.on('status', (status) => sendTo(mainWindow, 'update:status', status));
  if (!HIDDEN || env('PD_UPDATE_API')) updates.start();
}

// Windows only shows desktop notifications for an app with an ID, the installer's appId.
if (process.platform === 'win32') {
  let appId = 'com.streamorchard.peardrops';
  try {
    appId = require(path.join(APP_ROOT, 'package.json')).build?.appId || appId;
  } catch {}
  app.setAppUserModelId(app.isPackaged ? appId : process.execPath);
}

app.whenReady().then(async () => {
  for (const ses of [session.defaultSession, session.fromPartition(PARTITION)]) guard.lockSession(ses, isApp);
  session.fromPartition(PARTITION).setUserAgent(app.userAgentFallback);
  if (HIDDEN && process.platform === 'darwin') app.dock.hide();
  if (process.platform === 'darwin' && !HIDDEN) {
    const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'renderer', 'assets', 'icon.png'));
    if (!icon.isEmpty()) app.dock.setIcon(icon);
  }

  // Every Kick page the app opens is muted at the window level.
  // Kick's pages (player, login, API page) are always muted. The app's own pages
  // aren't: the dashboard plays the alert chime.
  const kickSession = session.fromPartition(PARTITION);
  app.on('web-contents-created', (_event, contents) => {
    if (contents.session === kickSession || HIDDEN) contents.setAudioMuted(true);
    guardContents(contents, { isApp });
  });

  store = new Store();
  db = openDb(app.getPath('userData'), { log: (text) => console.warn(text) });
  // Once, from an older version's files.
  const imported = db.importFiles(app.getPath('userData'));
  security = await setupSecurity(() => store.get().forgetOnQuit, db.slot('security'), { closePages: closeKickPages });
  api = DEMO ? demo.api : new KickApi();
  if (DEMO) demo.installStage(session.fromPartition(PARTITION), { eventSeconds: Number(env('PD_DEMO_EVENT_SECONDS')) || 120 });
  createMainWindow();
  watcher = new Watcher(() => mainWindow, () => store.get());
  history = new History(db).load();
  // The data was damaged: say what was put back, in History.
  if (db.restored) {
    const at = db.restored.at && new Date(db.restored.at);
    history.add(db.restored.from ? 'data-restored' : 'data-reset', {
      backup: db.restored.from,
      text: at
        ? `The app’s data was damaged, so the backup from ${at.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} was put back`
        : 'The app’s data was damaged and there was no good backup, so it started afresh',
    });
  }
  backups = new Backups({ db, dir: app.getPath('userData'), settings: () => store.get(), history, log: (text) => console.warn(text) }).start();
  backups.on('change', () => sendState());
  archive = new DropArchive(app.getPath('userData'), db, {
    resolveUrl: assetUrl,
    // Downloaded in the Kick session, as the site itself would load them.
    fetchImage: async (url) => {
      const res = await session.fromPartition(PARTITION).fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > 5 * 1024 * 1024) throw new Error('too large');
      return { buffer, type: res.headers.get('content-type') };
    },
  }).load();
  if (DEMO) demo.seedArchive(archive);
  // Drops from before the archive existed, rebuilt from what the history recorded (once: since
  // then, the archive has every drop the history mentions).
  if (imported.includes(OLD_FILES.history)) archive.backfill(history.all());
  protocol.handle(IMAGE_SCHEME, async (request) => {
    const file = archive.fileFor(request.url);
    if (!file) return new Response(null, { status: 404 });
    try {
      return new Response(await fs.promises.readFile(file.path), { headers: { 'content-type': file.type, 'cache-control': 'max-age=31536000, immutable' } });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
  if (DEMO && env('PD_DEMO_SEED') && history.isEmpty()) demo.seedHistoryLog(history);
  createNotifier();
  farmer = new Farmer({ api, watcher, store, history, archive, cache: db.cache });
  notifyFarming();
  farmer.seedFromHistory();
  farmer.loadCache();
  let historyTimer = null;
  history.onAdd(() => {
    if (historyTimer) return;
    historyTimer = setTimeout(() => {
      historyTimer = null;
      sendTo(mainWindow, 'history:changed');
    }, 1000);
  });
  farmer.on('update', sendState);
  // Connected apps, through Grapevine. Demo mode and developer copies get a folder of their own, so
  // they never see (or pair with) the apps you really use; GRAPEVINE_DIR still wins, to try one
  // with a developer copy of Stream Multiview.
  linkDir = env('GRAPEVINE_DIR') || (DEMO || env('PD_DEV_DATA') ? path.join(app.getPath('userData'), 'grapevine') : null);
  const crypt = safeStorage.isEncryptionAvailable()
    ? { encrypt: (t) => safeStorage.encryptString(t).toString('base64'), decrypt: (t) => safeStorage.decryptString(Buffer.from(t, 'base64')) }
    : {};
  connected = new Connected({
    store,
    farmer,
    auth: () => auth,
    version: app.getVersion(),
    history,
    show: showMain, // a click on Stream Multiview's farming widget
    keys: fileKeyStore(path.join(app.getPath('userData'), 'grapevine.json'), crypt),
    // Grapevine reads GRAPEVINE_DIR itself: an installed copy always uses the shared place.
    place: { env: { ...process.env, GRAPEVINE_DIR: linkDir ?? '' } },
    // Demo mode: "installed" means a folder the stand-in makes, not the real Stream Multiview.
    appDataDir: DEMO ? path.join(app.getPath('userData'), 'demo-apps') : app.getPath('appData'),
  });
  connected.on('change', sendState);
  // The Activity view refetches its page when there's something new (at most a few times a second).
  let activityTimer = null;
  connected.on('activity', () => {
    if (activityTimer) return;
    activityTimer = setTimeout(() => {
      activityTimer = null;
      sendTo(mainWindow, 'connected:activity');
    }, 300);
  });
  farmer.on('update', () => connected.update());
  connected.sync();
  // Stored images replace Kick's links as they arrive.
  archive.on('images', () => {
    farmer.buildModel();
    farmer.changed();
  });
  // Dev copies and tests (own data folder) can reach the engine from Playwright.
  if (env('PD_DEV_DATA')) global.pdDebug = { api, farmer, watcher, store, connected };
  tray = new TrayController({
    ipc: trayIpc,
    preload: path.join(__dirname, '..', 'preload', 'app.js'),
    onShowMain: showMain,
    onQuit: () => app.quit(),
    onAction: (name) => {
      if (name === 'pause') farmer.setPaused(true);
      else if (name === 'resume') farmer.setPaused(false);
      else if (name === 'skip') farmer.skip();
      else if (name === 'refresh') farmer.tick({ force: true });
    },
  });
  tray.create();
  setInterval(updateTray, 15_000);
  if (DEMO) setupDemo();
  powerMonitor.on('resume', () => auth.status === 'signed-in' && !farmer.paused && farmer.handleResume());
  farmer.on('auth-lost', () => {
    stopFarming();
    setAuth({ status: 'signed-out', user: null });
    notifier.send('signedOut', { title: 'Signed out of Kick', body: 'Your Kick login expired. Sign in again to keep collecting drops.' });
    showMain();
  });
  farmer.on('stall-alert', ({ minutes, events }) => {
    notifier.send('conflict', { title: 'Another Kick stream is taking your drop credit', body: `${events} watch events got no credit. Kick credits only one stream per account, so close any other streams to continue progressing drops.` });
    sendTo(mainWindow, 'alert', { kind: 'stall', minutes, events });
    if (process.platform === 'darwin' && !HIDDEN && mainWindow && !mainWindow.isFocused()) app.dock.bounce('informational');
  });
  registerIpc();
  setupUpdates();

  mainWindow.webContents.once('did-finish-load', () => sendState());
  await checkAuth();

  app.on('activate', () => showMain());
});

app.on('before-quit', () => {
  quitting = true;
  connected?.stop(); // says goodbye, so the other app knows at once
  archive?.flush();
  updates?.stop();
  backups?.stop();
});

// Last, after farming has stopped: saves the run's numbers so a restart carries them on, and
// closes the database.
app.on('will-quit', () => {
  farmer?.flushCache();
  archive?.flush();
  db?.close();
});

app.on('window-all-closed', () => {
  stopFarming();
  app.quit();
});
