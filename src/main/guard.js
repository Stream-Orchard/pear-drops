// What the app lets in (the same rules as Stream Multiview's): who may send its messages, what
// pages may ask for, which addresses open where, and which settings only copies run from source
// take. main.js wires these in; nothing here needs a window (the unit tests call it with stand-ins).
const path = require('path');
const { fileURLToPath } = require('url');

// ------------------------------------------------------------------ addresses

const urlOf = (u) => {
  try {
    return new URL(String(u));
  } catch {
    return null;
  }
};

/** An address to open in the browser: http or https, without a name and password in it ('' for anything else). */
function webUrl(u) {
  const x = urlOf(u);
  return x && (x.protocol === 'https:' || x.protocol === 'http:') && !x.username && !x.password ? x.href : '';
}

const httpsHost = (u) => {
  const x = urlOf(u);
  return x && x.protocol === 'https:' ? x.hostname.toLowerCase() : '';
};
const KICK_HOST = /(^|\.)kick\.com$/;
// Kick's sign-in providers (Google, Apple), which its login sends you to.
const LOGIN_HOST = /(^|\.)(google\.com|apple\.com)$/;
const isKick = (u) => KICK_HOST.test(httpsHost(u));
const isLogin = (u) => LOGIN_HOST.test(httpsHost(u));

/**
 * A page asks to open `url` in a new window. fromApp: one of the app's own pages. login: the sign-in
 * window (or a pop-up of it). recent: you clicked or typed in that page just before.
 * -> 'app' (a window in the app, with the Kick login), 'external' (the browser) or 'deny'.
 */
function popupFor(url, { fromApp = false, login = false, recent = false } = {}) {
  if (login && (isKick(url) || isLogin(url))) return 'app';
  return webUrl(url) && (fromApp || recent) ? 'external' : 'deny';
}

/** Whether the sign-in window (or one of its pop-ups) may go to `url`: Kick and its sign-in providers. */
const mayNavigate = (url) => isKick(url) || isLogin(url) || String(url) === 'about:blank';

// ------------------------------------------------------------------ who sent a message

/**
 * files: { main, tray } the page each app window shows; windows(): those windows now.
 * -> (event) => 'main' | 'tray' | null (anything else: a Kick page, a pop-up, a frame in a page)
 */
function senderRole({ files, windows }) {
  const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  return (e) => {
    const wc = e?.sender;
    const f = e?.senderFrame;
    if (!wc || !f || f.parent) return null; // only the window's own page, not a frame in it
    const u = urlOf(f.url);
    if (!u || u.protocol !== 'file:') return null;
    let file;
    try {
      file = path.normalize(fileURLToPath(u));
    } catch {
      return null;
    }
    const w = windows();
    for (const role of Object.keys(files)) {
      const win = w[role];
      if (win && !win.isDestroyed() && win.webContents === wc && same(file, path.normalize(files[role]))) return role;
    }
    return null;
  };
}

/** ipcMain.handle / ipcMain.on that only answer the app windows in `roles` (anyone else is refused, and denied() told). */
function guardedIpc(ipcMain, roleOf, roles, denied = () => {}) {
  const ok = (e) => roles.includes(roleOf(e));
  return {
    handle: (channel, fn) =>
      ipcMain.handle(channel, (e, ...args) => {
        if (ok(e)) return fn(e, ...args);
        denied(channel, e);
        throw new Error(`${channel} isn't allowed from there`);
      }),
    on: (channel, fn) =>
      ipcMain.on(channel, (e, ...args) => {
        if (ok(e)) fn(e, ...args);
        else denied(channel, e);
      }),
  };
}

// ------------------------------------------------------------------ what pages may ask for

// The app's own pages: copying (the Activity view's Copy). Kick's pages: full screen and copying.
// Everything else is refused: microphone, camera, screen, location, notifications (the app sends its
// own), reading the clipboard, opening other apps (links go through the app), devices.
const APP_ASKS = new Set(['clipboard-sanitized-write']);
const SITE_ASKS = new Set(['fullscreen', 'clipboard-sanitized-write']);
const mayAsk = ({ app, permission }) => (app ? APP_ASKS : SITE_ASKS).has(permission);

/** Puts the rules on a session, once. isApp(webContents, url) says whether it's one of the app's own pages. */
const locked = new WeakSet();
function lockSession(ses, isApp) {
  if (!ses || locked.has(ses)) return;
  locked.add(ses);
  const app = (wc, url) => {
    try {
      return !!wc && /^file:/i.test(String(url || '')) && !!isApp(wc);
    } catch {
      return false;
    }
  };
  ses.setPermissionRequestHandler((wc, permission, callback, details = {}) => callback(mayAsk({ app: app(wc, details.requestingUrl), permission })));
  ses.setPermissionCheckHandler((wc, permission, origin, details = {}) => mayAsk({ app: app(wc, details.requestingUrl || origin), permission }));
  ses.setDevicePermissionHandler?.(() => false);
  // Asked to pick a device: none (without an answer, Electron would pick the first one).
  for (const event of ['select-hid-device', 'select-serial-port', 'select-usb-device']) {
    ses.on(event, (e, _details, callback) => {
      e.preventDefault();
      try {
        callback(event === 'select-usb-device' ? undefined : '');
      } catch {}
    });
  }
}

// ------------------------------------------------------------------ installed copies

/**
 * The PD_ settings that change what the app does (a stand-in GitHub, a data folder, demo mode) only
 * count in copies run from source: an installed app ignores them.
 */
const devEnv = ({ packaged, env = process.env }) => (name) => (packaged ? '' : env[name] || '');

// Switches that would let another program drive or inspect an installed copy.
const DEBUG_SWITCHES = ['remote-debugging-port', 'remote-debugging-pipe', 'inspect', 'inspect-brk', 'inspect-port', 'js-flags'];
/** Whether an installed copy was started with one of them (it then quits). */
const debugSwitch = ({ packaged, hasSwitch }) => (packaged ? DEBUG_SWITCHES.find((s) => hasSwitch(s)) || '' : '');

module.exports = { webUrl, isKick, isLogin, popupFor, mayNavigate, senderRole, guardedIpc, mayAsk, lockSession, devEnv, debugSwitch };
