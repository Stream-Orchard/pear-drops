const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Updates, parseChangelog } = require('../../../src/main/updates');
const { makeZip } = require('../../launch/github');

const PKG = { name: 'kick-drops-client', version: '0.1.0', main: 'src/main/main.js' };
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

/** A response with a JSON body, or a streamed binary one. */
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
const binary = (buf) => {
  let sent = false;
  return { ok: true, status: 200, headers: { get: () => String(buf.length) }, body: { getReader: () => ({ read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: buf })) }) } };
};

function setup({ release, installed = false, platform = 'linux', devCopy = false, pkgRepo = 'me/kick-drops', saved, files } = {}) {
  const appRoot = tmp('kdf-app-');
  fs.writeFileSync(path.join(appRoot, 'package.json'), JSON.stringify(PKG));
  const dataDir = tmp('kdf-data-');
  if (saved) fs.writeFileSync(path.join(dataDir, 'updates.json'), JSON.stringify(saved));
  const zip = makeZip(
    Object.entries(
      files ?? {
        'package.json': JSON.stringify({ ...PKG, version: '0.1.0' }), // not stamped yet: the release's version wins
        'src/main/main.js': 'new main',
        'src/renderer/index.html': 'new page',
      },
    ).map(([name, content]) => [`me-kick-drops-abc/${name}`, content]),
  );
  const calls = [];
  const fetch = async (url) => {
    calls.push(['fetch', url]);
    if (url.endsWith('/releases/latest')) return release ? json(release) : json({}, 404);
    if (url.endsWith('/repos/me/kick-drops')) return json({}, 404);
    if (url.includes('zip') || url.includes('download')) return binary(zip);
    return json({}, 404);
  };
  const updates = new Updates({
    version: '0.1.0',
    installed,
    platform,
    appRoot,
    dataDir,
    tempDir: tmp('kdf-tmp-'),
    downloadsDir: tmp('kdf-dl-'),
    execPath: '/usr/bin/kick-drops',
    pid: 1,
    pkgRepo,
    devCopy,
    fetch,
    runTool: async () => '',
    spawn: (...a) => calls.push(['spawn', ...a]),
    openExternal: (url) => calls.push(['openExternal', url]),
    openPath: (f) => calls.push(['openPath', f]),
    quit: () => calls.push(['quit']),
    relaunch: () => calls.push(['relaunch']),
  }).load();
  const states = [];
  updates.on('status', (s) => states.push(s.state));
  return { updates, appRoot, dataDir, calls, states };
}

const RELEASE = { tag_name: 'v0.2.0', name: 'v0.2.0', body: '- Done tab', zipball_url: 'https://api.github.com/zip', html_url: 'https://github.com/me/kick-drops/releases/tag/v0.2.0', assets: [] };

test('parseChangelog reads versions, the current one and their items', () => {
  const list = parseChangelog('# What’s new\n\n## 0.2.0 (current)\n- Done tab\n- Updater\n\n## 0.1.0\n* First version\n');
  assert.deepEqual(list, [
    { version: '0.2.0', current: true, items: ['Done tab', 'Updater'] },
    { version: '0.1.0', current: false, items: ['First version'] },
  ]);
  assert.deepEqual(parseChangelog(''), []);
});

test('the repository comes from package.json until one is saved; a new version is noticed once', () => {
  const { updates, dataDir } = setup({ saved: { seenVersion: '0.0.9', auto: false } });
  assert.equal(updates.status().repo, 'me/kick-drops');
  assert.equal(updates.status().auto, false);
  assert.deepEqual(updates.status().justUpdated, { from: '0.0.9', to: '0.1.0' });
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'updates.json'), 'utf8')).seenVersion, '0.1.0');
  updates.dismissJustUpdated();
  assert.equal(updates.status().justUpdated, null);
  assert.equal(setup().updates.status().justUpdated, null, 'a first run isn’t an update');
});

test('a source copy downloads, installs the new files and restarts into them', async () => {
  const { updates, appRoot, states, calls } = setup({ release: RELEASE });
  const s = await updates.check();
  assert.equal(s.state, 'ready');
  assert.equal(s.installed, '0.2.0');
  assert.deepEqual(states.slice(0, 3), ['checking', 'available', 'downloading']);
  assert.equal(fs.readFileSync(path.join(appRoot, 'src', 'main', 'main.js'), 'utf8'), 'new main');
  assert.equal(JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')).version, '0.2.0', 'stamped with the release’s version');
  assert.ok(s.lastCheck > 0);
  assert.deepEqual(updates.restart(), { ok: true });
  assert.deepEqual(calls.at(-1), ['relaunch']);
  // Checking again after installing: still waiting for the restart.
  assert.equal((await updates.check()).state, 'ready');
});

test('with automatic updates off, or in a dev copy, it only tells you', async () => {
  const off = setup({ release: RELEASE, saved: { auto: false } });
  assert.equal((await off.updates.check()).state, 'available');
  const dev = setup({ release: RELEASE, devCopy: true });
  assert.equal((await dev.updates.check()).state, 'available');
  assert.equal((await dev.updates.install()).state, 'available', 'never installs over work in progress');
  assert.equal(fs.readFileSync(path.join(dev.appRoot, 'package.json'), 'utf8'), JSON.stringify(PKG));
});

test('up to date, no repository, a bad repository name and errors', async () => {
  assert.equal((await setup({ release: { ...RELEASE, tag_name: 'v0.1.0' } }).updates.check()).state, 'uptodate');
  const none = setup({ pkgRepo: '' });
  assert.equal((await none.updates.check()).state, 'norepo');
  assert.equal(none.updates.settings({ repo: 'https://github.com/Me/Pear-Drops.git/' }).repo, 'Me/Pear-Drops');
  assert.equal(none.updates.settings({ repo: 'not a repo' }).error, 'badrepo');
  assert.equal(none.updates.settings({ auto: false }).auto, false);
  const missing = await setup({ release: null }).updates.check();
  assert.equal(missing.state, 'error');
  assert.equal(missing.error, 'notfound');
});

test('an update that isn’t this app is refused', async () => {
  const { updates, appRoot } = setup({ release: RELEASE, files: { 'package.json': JSON.stringify({ name: 'other', version: '9.0.0' }), 'src/main/main.js': 'x', 'src/renderer/index.html': 'y' } });
  const s = await updates.check();
  assert.equal(s.state, 'error');
  assert.equal(s.error, 'wrongapp');
  assert.equal(JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')).name, 'kick-drops-client');
});

const withAssets = (names) => ({ ...RELEASE, assets: names.map((name) => ({ name, browser_download_url: `https://github.com/download/${name}` })) });

test('Windows: downloads the installer, which runs silently on restart', async () => {
  const { updates, calls } = setup({ release: withAssets(['Pear-Drops-Setup-0.2.0.exe']), installed: true, platform: 'win32' });
  const s = await updates.check();
  assert.equal(s.state, 'ready');
  assert.equal(s.progress, 1);
  assert.deepEqual(updates.restart(), { ok: true });
  const spawn = calls.find((c) => c[0] === 'spawn');
  assert.match(spawn[1], /Pear-Drops-Setup-0\.2\.0\.exe$/);
  assert.deepEqual(spawn[2], ['/S', '--force-run']);
});

test('Mac: when the app can’t swap itself, it falls back to the disk image', async () => {
  const { updates, calls } = setup({ release: withAssets(['Pear-Drops-0.2.0-mac.dmg', 'Pear-Drops-0.2.0-mac.zip']), installed: true, platform: 'darwin' });
  const s = await updates.check();
  assert.equal(s.state, 'ready');
  assert.equal(s.swap, false, 'not an app bundle here, so no swap');
  assert.deepEqual(updates.restart(), { ok: true, dmg: true });
  assert.match(calls.at(-1)[1], /mac\.dmg$/);
});

test('an installed app with no installer for its system sends you to the release page', async () => {
  const { updates, calls } = setup({ release: withAssets(['notes.txt']), installed: true, platform: 'win32' });
  const s = await updates.check();
  assert.equal(s.state, 'available');
  assert.equal(s.manual, true);
  await updates.install();
  assert.deepEqual(calls.at(-1), ['openExternal', RELEASE.html_url]);
});
