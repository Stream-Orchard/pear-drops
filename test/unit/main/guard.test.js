// What the app lets in: links, pop-ups, who may send its messages, what pages may ask for, and the
// settings only copies run from source take.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const guard = require('../../../src/main/guard');

test('only http and https addresses open in the browser, never another app or a name and password', () => {
  assert.equal(guard.webUrl('https://kick.com/arcadia'), 'https://kick.com/arcadia');
  assert.equal(guard.webUrl('http://example.com'), 'http://example.com/');
  for (const bad of ['search-ms:query=x', 'ms-msdt:/id', 'file:///etc/passwd', 'javascript:alert(1)', 'x-apple.systempreferences:x', 'https://me:pw@kick.com/', 'https://me@kick.com/', 'not a url', '', null, undefined, 42])
    assert.equal(guard.webUrl(bad), '', String(bad));
});

test('Kick and its sign-in providers, over https only', () => {
  assert.ok(guard.isKick('https://kick.com/'));
  assert.ok(guard.isKick('https://player.kick.com/arcadia'));
  assert.ok(!guard.isKick('http://kick.com/'), 'not over http');
  assert.ok(!guard.isKick('https://kick.com.example.com/'));
  assert.ok(!guard.isKick('https://notkick.com/'));
  assert.ok(guard.isLogin('https://accounts.google.com/o/oauth2'));
  assert.ok(guard.isLogin('https://appleid.apple.com/auth'));
  assert.ok(!guard.isLogin('https://google.com.example.com/'));
});

test('pop-ups: the sign-in window keeps Kick and its providers inside; Kick pages open links only just after a click', () => {
  // The sign-in window: Kick and Google/Apple open as windows with the login; anything else goes to the browser after a click.
  assert.equal(guard.popupFor('https://accounts.google.com/x', { login: true }), 'app');
  assert.equal(guard.popupFor('https://kick.com/x', { login: true }), 'app');
  assert.equal(guard.popupFor('https://example.com/', { login: true, recent: true }), 'external');
  assert.equal(guard.popupFor('https://example.com/', { login: true }), 'deny');
  // A Kick page (an ad, a script): nothing without a click, and only web addresses with one.
  assert.equal(guard.popupFor('https://example.com/'), 'deny');
  assert.equal(guard.popupFor('https://example.com/', { recent: true }), 'external');
  assert.equal(guard.popupFor('https://accounts.google.com/', { recent: true }), 'external', 'outside the sign-in window, a sign-in page is just a link');
  assert.equal(guard.popupFor('search-ms:query=x', { recent: true }), 'deny');
  // The app's own pages: web addresses only, no click needed (the app's links).
  assert.equal(guard.popupFor('https://github.com/x', { fromApp: true }), 'external');
  assert.equal(guard.popupFor('file:///etc/passwd', { fromApp: true }), 'deny');
});

test('the sign-in window stays on Kick and its sign-in providers', () => {
  for (const ok of ['https://kick.com/', 'https://www.kick.com/login', 'https://accounts.google.com/signin', 'https://appleid.apple.com/auth', 'about:blank']) assert.ok(guard.mayNavigate(ok), ok);
  for (const bad of ['https://example.com/', 'http://kick.com/', 'search-ms:query=x', 'file:///etc/passwd']) assert.ok(!guard.mayNavigate(bad), bad);
});

/** A stand-in window showing `file`, and a message from it (or from a frame in it). */
const fakeWindow = (destroyed = false) => {
  const wc = {};
  return { webContents: wc, isDestroyed: () => destroyed };
};
const from = (win, url, { parent = null } = {}) => ({ sender: win.webContents, senderFrame: { url, parent } });

test('messages are answered only from the app’s own windows, showing their own page', () => {
  const root = path.resolve('/app/src/renderer');
  const files = { main: path.join(root, 'index.html'), tray: path.join(root, 'tray.html') };
  const main = fakeWindow();
  const tray = fakeWindow();
  const roleOf = guard.senderRole({ files, windows: () => ({ main, tray }) });
  const url = (f) => pathToFileURL(f).href;
  assert.equal(roleOf(from(main, url(files.main))), 'main');
  assert.equal(roleOf(from(tray, url(files.tray))), 'tray');
  assert.equal(roleOf(from(main, url(files.tray))), null, 'the main window showing another page');
  assert.equal(roleOf(from(main, 'https://kick.com/')), null, 'the window sent to a website');
  assert.equal(roleOf(from(main, url(files.main), { parent: {} })), null, 'a frame inside the page');
  assert.equal(roleOf(from(fakeWindow(), url(files.main))), null, 'another window with the same page');
  assert.equal(roleOf({ sender: main.webContents, senderFrame: null }), null, 'a frame that is gone');
  assert.equal(roleOf(null), null);
  assert.equal(roleOf(from(main, 'not a url')), null);
  assert.equal(roleOf(from(main, 'file://remote-host/share/index.html')), null, 'a file elsewhere');
  const gone = fakeWindow(true);
  assert.equal(guard.senderRole({ files, windows: () => ({ main: gone }) })(from(gone, url(files.main))), null, 'a closed window');
});

test('guarded handlers refuse anyone else, and say so', async () => {
  const ipc = { handlers: {}, listeners: {}, handle: (c, fn) => (ipc.handlers[c] = fn), on: (c, fn) => (ipc.listeners[c] = fn) };
  const denied = [];
  const roleOf = (e) => e.role;
  const g = guard.guardedIpc(ipc, roleOf, ['main'], (channel) => denied.push(channel));
  g.handle('farm:pause', (_e, x) => `paused ${x}`);
  let heard = 0;
  g.on('ping', () => (heard += 1));
  assert.equal(await ipc.handlers['farm:pause']({ role: 'main' }, 1), 'paused 1');
  assert.throws(() => ipc.handlers['farm:pause']({ role: null }, 1), /farm:pause isn't allowed from there/);
  assert.throws(() => ipc.handlers['farm:pause']({ role: 'tray' }, 1), /isn't allowed/);
  ipc.listeners.ping({ role: 'main' });
  ipc.listeners.ping({ role: null });
  assert.equal(heard, 1);
  assert.deepEqual(denied, ['farm:pause', 'farm:pause', 'ping']);
  // The default: refused quietly.
  const quiet = guard.guardedIpc(ipc, roleOf, ['main']);
  quiet.on('quiet', () => assert.fail('not from there'));
  ipc.listeners.quiet({ role: null });
});

test('every message handler in the app goes through the guard (the player’s own check its pages by view)', () => {
  const dir = path.join(__dirname, '..', '..', '..', 'src', 'main');
  const raw = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const m of text.matchAll(/ipcMain\.(handle|on|handleOnce|once)\(\s*'([^']+)'/g)) raw.push(`${file} ${m[2]}`);
  }
  // watcher.js answers only its own Kick views (event.sender === the view), which no file: page check fits.
  assert.deepEqual(raw.sort(), ['watcher.js watch:event', 'watcher.js watch:quality']);
  const main = fs.readFileSync(path.join(dir, 'main.js'), 'utf8');
  assert.ok(/mainIpc\.handle\('settings:set'/.test(main), 'settings answer the main window only');
  assert.ok(/mainIpc\.handle\('update:install'/.test(main), 'updates too');
  assert.ok(/mainIpc\.handle\('auth:login'/.test(main), 'and logins');
});

test('pages ask: the app’s own may copy; Kick’s may go full screen and copy; nothing else, for anyone', () => {
  assert.ok(guard.mayAsk({ app: true, permission: 'clipboard-sanitized-write' }));
  assert.ok(guard.mayAsk({ app: false, permission: 'fullscreen' }));
  assert.ok(guard.mayAsk({ app: false, permission: 'clipboard-sanitized-write' }));
  for (const permission of ['media', 'display-capture', 'clipboard-read', 'openExternal', 'notifications', 'geolocation', 'hid', 'serial', 'usb', 'midiSysex', 'pointerLock'])
    for (const app of [true, false]) assert.ok(!guard.mayAsk({ app, permission }), `${permission} (${app ? 'app' : 'Kick'})`);
});

test('every session gets the rules once: permissions, devices, and device pickers that pick nothing', () => {
  const ses = Object.assign(new EventEmitter(), { setPermissionRequestHandler: (f) => (ses.request = f), setPermissionCheckHandler: (f) => (ses.check = f), setDevicePermissionHandler: (f) => (ses.device = f) });
  const appPage = {};
  guard.lockSession(ses, (wc) => wc === appPage);
  const asked = (wc, permission, url) => new Promise((r) => ses.request(wc, permission, r, { requestingUrl: url }));
  return (async () => {
    assert.equal(await asked(appPage, 'clipboard-sanitized-write', 'file:///app/index.html'), true);
    assert.equal(await asked({}, 'clipboard-sanitized-write', 'https://kick.com/'), true);
    assert.equal(await asked(appPage, 'fullscreen', 'file:///app/index.html'), false, 'the app’s own page has no use for it');
    assert.equal(await asked({}, 'media', 'https://kick.com/'), false);
    assert.equal(await asked(appPage, 'openExternal', 'https://kick.com/'), false, 'a website in an app window is a website');
    assert.equal(await new Promise((r) => ses.request(null, 'fullscreen', r)), true, 'no details: treated as a site');
    assert.equal(ses.check({}, 'clipboard-read', 'https://kick.com', {}), false);
    assert.equal(ses.check(appPage, 'clipboard-sanitized-write', 'file://', { requestingUrl: 'file:///app/index.html' }), true);
    assert.equal(ses.check(appPage, 'clipboard-sanitized-write', 'file://'), true, 'by its origin when there are no details');
    assert.equal(ses.device(), false);
    for (const [event, none] of [['select-hid-device', ''], ['select-serial-port', ''], ['select-usb-device', undefined]]) {
      let prevented = false;
      let picked = 'nothing yet';
      ses.emit(event, { preventDefault: () => (prevented = true) }, {}, (id) => (picked = id));
      assert.ok(prevented, event);
      assert.equal(picked, none, event);
    }
    // A picker whose answer throws (the request is gone) is fine.
    ses.emit('select-hid-device', { preventDefault() {} }, {}, () => {
      throw new Error('gone');
    });
    // Once only.
    const before = ses.request;
    guard.lockSession(ses, () => true);
    assert.equal(ses.request, before);
    guard.lockSession(null, () => true);
    // isApp throwing counts as not the app.
    const other = Object.assign(new EventEmitter(), { setPermissionRequestHandler: (f) => (other.request = f), setPermissionCheckHandler: () => {} });
    guard.lockSession(other, () => {
      throw new Error('no window');
    });
    assert.equal(await new Promise((r) => other.request({}, 'clipboard-sanitized-write', r, { requestingUrl: 'file:///x' })), true, 'copying is allowed either way');
    assert.equal(await new Promise((r) => other.request({}, 'fullscreen', r, { requestingUrl: 'file:///x' })), true, 'as a site');
  })();
});

test('PD_ settings only count when run from source; installed copies refuse debugging switches', () => {
  const env = { PD_UPDATE_API: 'http://127.0.0.1:9', PD_DEMO: '1' };
  assert.equal(guard.devEnv({ packaged: false, env })('PD_UPDATE_API'), 'http://127.0.0.1:9');
  assert.equal(guard.devEnv({ packaged: false, env })('PD_NOPE'), '');
  assert.equal(guard.devEnv({ packaged: true, env })('PD_UPDATE_API'), '');
  assert.equal(guard.devEnv({ packaged: true, env })('PD_DEMO'), '');
  assert.equal(guard.devEnv({ packaged: false })('PD_SURELY_NOT_SET_ANYWHERE'), '', 'process.env by default');
  const has = (list) => (s) => list.includes(s);
  assert.equal(guard.debugSwitch({ packaged: true, hasSwitch: has(['remote-debugging-port']) }), 'remote-debugging-port');
  assert.equal(guard.debugSwitch({ packaged: true, hasSwitch: has(['inspect-brk']) }), 'inspect-brk');
  assert.equal(guard.debugSwitch({ packaged: true, hasSwitch: has(['autoplay-policy']) }), '');
  assert.equal(guard.debugSwitch({ packaged: false, hasSwitch: has(['remote-debugging-port']) }), '', 'tests drive copies run from source');
});
