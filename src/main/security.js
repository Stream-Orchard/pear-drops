// Keeping the saved Kick login safe (same approach as Stream Multiview):
//   1. scripts/harden.js switches on Electron's cookie encryption, so the login is
//      encrypted with a key held by the macOS Keychain / Windows DPAPI. Logins saved
//      before that are re-saved once here so they get encrypted too.
//   2. Optional "forget my login when I quit": the Kick session is wiped on quit, and
//      at the next start if the app closed without getting to (e.g. it crashed).
//   3. Kick pages get no extra permissions and can't open windows inside the app.
const { app, session, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { PARTITION } = require('./kick-api');

const file = () => path.join(app.getPath('userData'), 'security.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8')) || {};
  } catch {
    return {};
  }
}

function save(data) {
  try {
    fs.writeFileSync(file(), JSON.stringify(data));
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

async function wipe() {
  const ses = session.fromPartition(PARTITION);
  await ses.clearStorageData().catch(() => {});
  await ses.clearCache().catch(() => {});
  await ses.cookies.flushStore().catch(() => {});
}

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

function lockDownSession() {
  const ses = session.fromPartition(PARTITION);
  // Autoplay is handled by a command-line switch; nothing on Kick needs more than this.
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'fullscreen'));
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'fullscreen');
}

function guardContents(contents) {
  // Links that try to open new windows go to the real browser instead.
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

/**
 * Call once the app is ready. Returns { encryption, setForget } for main.js.
 * getForget() reads the current "forget my login" setting.
 */
async function setupSecurity(getForget) {
  const sec = load();
  lockDownSession();

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
    wipe().finally(() => {
      wiped = true;
      sec.pendingWipe = false;
      save(sec);
      app.quit();
    });
  });

  return { encryption, setForget };
}

module.exports = { setupSecurity, guardContents, wipe };
