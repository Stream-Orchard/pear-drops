// Keeping the saved Kick login safe (same approach as Stream Multiview):
//   1. scripts/harden.js switches on Electron's cookie encryption, so the login is
//      encrypted with a key held by the macOS Keychain / Windows DPAPI. Logins saved
//      before that are re-saved once here so they get encrypted too.
//   2. Optional "forget my login when I quit": the Kick session is wiped on quit, and
//      at the next start if the app closed without getting to (e.g. it crashed).
//   3. Pages get no extra permissions (guard.js) and can't open windows inside the app. Links open
//      in the browser (http and https only), and from a Kick page only just after you clicked in it.
const { app, session, shell } = require('electron');
const { PARTITION, wipeSession } = require('./kick-api');
const { webUrl, popupFor, mayNavigate } = require('./guard');

// Where its own small state is saved (setupSecurity's `saved`, a db.js slot).
let saved = { load: () => ({}), save: () => {} };

function load() {
  try {
    return saved.load() || {};
  } catch {
    return {};
  }
}

function save(data) {
  try {
    saved.save(data);
  } catch {}
}

/** 'on' | 'off' | 'unknown'. Packaged builds always have it on (build/after-pack.js). */
async function encryptionState() {
  if (app.isPackaged) return 'on';
  try {
    const { getCurrentFuseWire, FuseV1Options, FuseState } = require('@electron/fuses');
    const wire = await getCurrentFuseWire(process.execPath);
    return wire[FuseV1Options.EnableCookieEncryption] === FuseState.ENABLE ? 'on' : 'off';
  } catch {
    return 'unknown';
  }
}

/** "Forget my login": the same wipe as signing out (kick-api.js). */
const wipe = (opts) => wipeSession(opts);

// Cookies written before encryption was switched on stay unencrypted on disk until
// they are written again.
async function encryptOldLogins(sec) {
  if (sec.migrated) return;
  const ses = session.fromPartition(PARTITION);
  const list = await ses.cookies.get({}).catch(() => []);
  for (const c of list) {
    const host = c.domain.replace(/^\./, '');
    await ses.cookies
      .set({
        url: `http${c.secure ? 's' : ''}://${host}${c.path || '/'}`,
        name: c.name,
        value: c.value,
        ...(c.hostOnly ? {} : { domain: c.domain }),
        path: c.path || '/',
        secure: c.secure,
        httpOnly: c.httpOnly,
        ...(c.session || !c.expirationDate ? {} : { expirationDate: c.expirationDate }),
        sameSite: c.sameSite || 'unspecified',
      })
      .catch(() => {});
  }
  await ses.cookies.flushStore().catch(() => {});
  sec.migrated = true;
  save(sec);
}

// When you last clicked or typed in each page: a Kick page opens links in the browser only just after that.
const lastInput = new WeakMap();
const RECENT_MS = 5000;
const recentInput = (contents) => Date.now() - (lastInput.get(contents) || 0) < RECENT_MS;

/**
 * Opens an address in the browser: http and https only (never another app's protocol), and for a
 * Kick page (`from`) only just after you clicked or typed in it. -> whether it opened.
 */
function openLink(url, { from = null } = {}) {
  const href = webUrl(url);
  if (!href || (from && !recentInput(from))) return false;
  Promise.resolve(shell.openExternal(href)).catch(() => {});
  return true;
}

/**
 * Every page the app makes (main.js calls this for each). isApp(contents) says whether it's one of the
 * app's own windows. Its pop-ups go to the browser (a Kick page's only just after a click), and the
 * app's own pages never leave their file: a link in one opens in the browser.
 */
function guardContents(contents, { isApp = () => false } = {}) {
  contents.on('input-event', (_event, input) => {
    if (/^(mouseDown|rawKeyDown|keyDown|gestureTap|touchStart)$/.test(input?.type)) lastInput.set(contents, Date.now());
  });
  contents.setWindowOpenHandler(({ url }) => {
    const fromApp = !!isApp(contents);
    if (popupFor(url, { fromApp, recent: recentInput(contents) }) === 'external') openLink(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (!/^file:/i.test(contents.getURL())) return;
    event.preventDefault();
    if (isApp(contents)) openLink(url);
  });
}

/**
 * The sign-in window and its pop-ups (Google, Apple): they stay on Kick and its sign-in providers,
 * and anything else opens in the browser. Their own pop-ups get the same rules.
 */
function keepOnKick(contents, popupOptions) {
  const keep = (event, url) => {
    if (event?.isMainFrame === false || mayNavigate(url)) return;
    event.preventDefault();
    openLink(url, { from: contents });
  };
  contents.on('will-navigate', keep);
  contents.on('will-redirect', keep);
  contents.setWindowOpenHandler(({ url }) => {
    const how = popupFor(url, { login: true, recent: recentInput(contents) });
    if (how === 'app') return { action: 'allow', overrideBrowserWindowOptions: popupOptions() };
    if (how === 'external') openLink(url);
    return { action: 'deny' };
  });
  contents.on('did-create-window', (win) => keepOnKick(win.webContents, popupOptions));
}

/**
 * Call once the app is ready. Returns { encryption, setForget } for main.js.
 * getForget() reads the current "forget my login" setting; `slot` is where its state is saved.
 * closePages() closes the pages using the login before it's wiped on quit.
 */
async function setupSecurity(getForget, slot, { closePages } = {}) {
  if (slot) saved = slot;
  const sec = load();

  // Last run had "forget" on but never got to wipe: do it now.
  if (sec.pendingWipe) {
    await wipe();
    sec.pendingWipe = false;
    save(sec);
  }

  const encryption = await encryptionState();
  if (encryption === 'on') await encryptOldLogins(sec);

  // While "forget" is on, a crash leaves this set so the next start wipes the login.
  const setForget = (value) => {
    sec.pendingWipe = !!value;
    save(sec);
  };
  setForget(getForget());

  let wiped = false;
  app.on('before-quit', (event) => {
    if (wiped || !getForget()) return;
    event.preventDefault();
    sec.pendingWipe = true;
    save(sec);
    wipe({ closePages }).finally(() => {
      wiped = true;
      sec.pendingWipe = false;
      save(sec);
      app.quit();
    });
  });

  return { encryption, setForget };
}

module.exports = { setupSecurity, guardContents, keepOnKick, openLink, recentInput, wipe };
