// Updates (ported from Stream Multiview): versions, installers, GitHub downloads, replacing files.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const u = require('../../../src/main/updater');
const { makeZip } = require('../../launch/github');

test('compareVersions orders versions, ignoring a leading v and missing zeros', () => {
  assert.equal(u.compareVersions('0.2.10', '0.2.9'), 1);
  assert.equal(u.compareVersions('v1.0', '1.0.0'), 0);
  assert.equal(u.compareVersions('0.1.0', '0.1.1'), -1);
});

const ASSETS = [
  { name: 'Pear-Drops-0.2.0-mac.dmg', url: 'https://x/d' },
  { name: 'Pear-Drops-0.2.0-mac.zip', url: 'https://x/z' },
  { name: 'Pear-Drops-Setup-0.2.0.exe', url: 'https://x/e' },
];

test('picks the Windows setup, the Mac disk image and the Mac app zip', () => {
  assert.equal(u.pickInstaller(ASSETS, 'win32').name, 'Pear-Drops-Setup-0.2.0.exe');
  assert.equal(u.pickInstaller(ASSETS, 'darwin').name, 'Pear-Drops-0.2.0-mac.dmg');
  assert.equal(u.pickInstaller(ASSETS, 'linux'), null);
  assert.equal(u.pickInstaller(null, 'win32'), null);
  assert.equal(u.pickMacZip(ASSETS).name, 'Pear-Drops-0.2.0-mac.zip');
  assert.equal(u.pickMacZip([{ name: 'source.zip' }]), null);
});

test('reads the app bundle and its signature requirement, and when it can replace itself', () => {
  assert.equal(u.macAppBundle('/Applications/Pear Drops.app/Contents/MacOS/Pear Drops'), '/Applications/Pear Drops.app');
  assert.equal(u.macAppBundle('/usr/bin/node'), '');
  assert.equal(u.designatedReq('Executable=/x\ndesignated => identifier "com.streamorchard.peardrops" and certificate leaf = H"ab"\n'), 'identifier "com.streamorchard.peardrops" and certificate leaf = H"ab"');
  assert.equal(u.designatedReq('nothing'), '');
  const app = '/Applications/Pear Drops.app';
  const req = 'identifier "x" and certificate leaf = H"ab"';
  assert.equal(u.macSwapBlocker({ app, writable: true, req }), '');
  assert.equal(u.macSwapBlocker({ app: '', writable: true, req }), 'nobundle');
  assert.equal(u.macSwapBlocker({ app: '/Volumes/Pear Drops/Pear Drops.app', writable: true, req }), 'volume');
  assert.equal(u.macSwapBlocker({ app: '/private/var/folders/x/AppTranslocation/y/Pear Drops.app', writable: true, req }), 'translocated');
  assert.equal(u.macSwapBlocker({ app, writable: false, req }), 'nowrite');
  assert.equal(u.macSwapBlocker({ app, writable: true, req: '' }), 'unsigned');
  assert.equal(u.macSwapBlocker({ app, writable: true, req: 'cdhash H"12"' }), 'adhoc');
});

const unix = process.platform !== 'win32';

test('canWriteInside says whether the app may change its own files, and leaves nothing behind', { skip: !unix || process.getuid?.() === 0 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-write-'));
  assert.equal(u.canWriteInside(dir), true);
  assert.deepEqual(fs.readdirSync(dir), []);
  fs.chmodSync(dir, 0o555);
  try {
    assert.equal(u.canWriteInside(dir), false);
  } finally {
    fs.chmodSync(dir, 0o755);
  }
});

function swapSetup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-swap-'));
  const app = path.join(dir, 'Applications', 'Pear Drops.app');
  const stage = path.join(dir, 'stage', 'Pear Drops.app');
  for (const [d, v] of [
    [app, 'old'],
    [stage, 'new'],
  ]) {
    fs.mkdirSync(path.join(d, 'Contents'), { recursive: true });
    fs.writeFileSync(path.join(d, 'Contents', 'v'), v);
  }
  const script = path.join(dir, 'swap.sh');
  const opener = path.join(dir, 'open.sh');
  const opened = path.join(dir, 'opened');
  fs.writeFileSync(script, u.macSwapScript());
  fs.writeFileSync(opener, `#!/bin/sh\nprintf '%s' "$1" > '${opened}'\n`);
  fs.chmodSync(opener, 0o755);
  return { dir, app, stage, script, opener, opened };
}

test('the swap script waits for the app to close, swaps in the new app and opens it', { skip: !unix }, async () => {
  const t = swapSetup();
  try {
    const running = spawn('sleep', ['0.6']); // stands in for the app, still closing
    const started = Date.now();
    await new Promise((res, rej) => spawn('/bin/sh', [t.script, String(running.pid), t.app, t.stage, t.opener]).on('exit', (c) => (c ? rej(new Error(`exit ${c}`)) : res())));
    assert.ok(Date.now() - started >= 400, 'it waited for the app to close');
    assert.equal(fs.readFileSync(path.join(t.app, 'Contents', 'v'), 'utf8'), 'new');
    assert.deepEqual(fs.readdirSync(path.dirname(t.app)), ['Pear Drops.app'], 'the old copy is gone');
    assert.equal(fs.readFileSync(t.opened, 'utf8'), t.app);
  } finally {
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
});

test('if the new app can’t be moved in, the swap script puts the old one back and opens it', { skip: !unix }, () => {
  const t = swapSetup();
  try {
    execFileSync('/bin/sh', [t.script, String(2 ** 22 + 12345), t.app, path.join(t.dir, 'missing.app'), t.opener]);
    assert.equal(fs.readFileSync(path.join(t.app, 'Contents', 'v'), 'utf8'), 'old');
    assert.equal(fs.readFileSync(t.opened, 'utf8'), t.app);
  } finally {
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
});

test('unpackMacApp checks the new app against this app’s signature requirement (stand-in tools)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-unpack-'));
  const calls = [];
  const run = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'ditto') fs.mkdirSync(path.join(args[3], 'Pear Drops.app'), { recursive: true });
    return '';
  };
  const app = await u.unpackMacApp('/x.zip', path.join(dir, 'out'), 'REQ', run);
  assert.equal(path.basename(app), 'Pear Drops.app');
  assert.deepEqual(calls[1], ['codesign', '--verify', '--deep', '--strict', '-R=REQ', app]);
  await assert.rejects(u.unpackMacApp('/x.zip', path.join(dir, 'empty'), 'REQ', async (cmd, args) => cmd === 'ditto' && fs.mkdirSync(args[3], { recursive: true })), /no app/);
});

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
function fakeFetch(routes) {
  return async (url) => {
    for (const [pattern, res] of routes) if (url.includes(pattern)) return res;
    return reply(404, {});
  };
}

test('latestInfo reads the newest release, its notes and installers', async () => {
  const info = await u.latestInfo(
    'me/pear-drops',
    fakeFetch([['/releases/latest', reply(200, { tag_name: 'v0.2.0', name: 'Shiny', body: '- Done tab', body_html: '<ul><li>Done tab</li></ul>', published_at: '2026-10-01T00:00:00Z', html_url: 'https://github.com/me/pear-drops/releases/tag/v0.2.0', assets: [{ name: 'a.dmg', browser_download_url: 'https://x/a.dmg', size: 3 }, { name: 'bad', browser_download_url: 'ftp://x' }] })]]),
  );
  assert.equal(info.version, '0.2.0');
  assert.equal(info.name, 'Shiny');
  assert.equal(info.notesHtml, '<ul><li>Done tab</li></ul>');
  assert.equal(info.published, '2026-10-01T00:00:00Z');
  assert.deepEqual(info.assets.map((a) => a.name), ['a.dmg'], 'only https downloads');
});

test('a download from this computer (http://127.0.0.1) only counts with a stand-in GitHub', async () => {
  const release = (url) => fakeFetch([['/releases/latest', reply(200, { tag_name: 'v0.2.0', assets: [{ name: 'local.exe', browser_download_url: url, size: 3 }] })]]);
  const seen = [];
  const recording = async (url, opts) => (seen.push(url), release('http://127.0.0.1:9/local.exe')(url, opts));
  // The real GitHub: a local download is a sign something is wrong.
  assert.deepEqual((await u.latestInfo('me/pear-drops', release('http://127.0.0.1:9/local.exe'))).assets, []);
  await assert.rejects(u.downloadTo(async () => assert.fail('never fetched'), 'http://127.0.0.1:9/local.exe', path.join(os.tmpdir(), 'pd-never')), /not https/);
  await assert.rejects(u.downloadTo(async () => assert.fail('never fetched'), 'file:///etc/passwd', path.join(os.tmpdir(), 'pd-never')), /not https/);
  try {
    u.useServer({ api: 'http://127.0.0.1:9' });
    const info = await u.latestInfo('me/pear-drops', recording);
    assert.deepEqual(info.assets.map((a) => a.name), ['local.exe']);
    assert.match(seen[0], /^http:\/\/127\.0\.0\.1:9\/repos\/me\/pear-drops\/releases\/latest$/);
    // Still only this computer, not any http address.
    assert.deepEqual((await u.latestInfo('me/pear-drops', release('http://example.com/a.exe'))).assets, []);
  } finally {
    u.useServer();
  }
  assert.deepEqual((await u.latestInfo('me/pear-drops', release('http://127.0.0.1:9/local.exe'))).assets, [], 'back to the real GitHub');
});

test('latestInfo falls back to package.json on the main branch, and reports missing repositories', async () => {
  const info = await u.latestInfo('me/pear-drops', fakeFetch([['/repos/me/pear-drops/releases', reply(404, {})], ['/package.json', reply(200, { version: '0.1.5' })], ['/repos/me/pear-drops', reply(200, { default_branch: 'main' })]]));
  assert.equal(info.version, '0.1.5');
  assert.equal(info.source, 'branch');
  await assert.rejects(u.latestInfo('me/nope', fakeFetch([])), /notfound/);
  await assert.rejects(u.latestInfo('not a repo', fakeFetch([])), /repo/);
  await assert.rejects(u.latestInfo('me/x', fakeFetch([['/releases/latest', reply(500, {})]])), /http 500/);
});

test('readZip reads stored and compressed files and skips folders; refuses non-zips', () => {
  const big = 'x'.repeat(5000);
  const entries = u.readZip(makeZip([['top/', null], ['top/a.js', 'console.log(1)'], ['top/b.html', big, true]]));
  assert.deepEqual(entries.map((e) => e.name), ['top/a.js', 'top/b.html']);
  assert.equal(entries[1].data.toString(), big);
  assert.throws(() => u.readZip(Buffer.from('this is not a zip file at all, just some text')), /zip/);
});

test('appFiles strips GitHub’s top folder, repo-only folders and unsafe paths, and finds a sub-folder app', () => {
  const files = u.appFiles(u.readZip(makeZip([['me-kd-abc/package.json', '{}'], ['me-kd-abc/src/main/main.js', 'm'], ['me-kd-abc/.github/workflows/x.yml', 'w'], ['me-kd-abc/node_modules/e/index.js', 'n'], ['me-kd-abc/../evil.js', 'e']])));
  assert.deepEqual(Object.keys(files).sort(), ['package.json', 'src/main/main.js']);
  const sub = u.appFiles(u.readZip(makeZip([['o-r-1/README.md', 'r'], ['o-r-1/app/package.json', '{}'], ['o-r-1/app/x.js', 'm']])));
  assert.deepEqual(Object.keys(sub).sort(), ['package.json', 'x.js']);
});

// ---- replacing a source copy's files

const PKG = { name: 'pear-drops', version: '0.1.0', main: 'src/main/main.js', devDependencies: { electron: '^44.8.0' } };
function appDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-upd-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(PKG));
  fs.mkdirSync(path.join(dir, 'src', 'main'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'renderer'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'main', 'main.js'), 'old main');
  fs.writeFileSync(path.join(dir, 'src', 'renderer', 'index.html'), 'old page');
  fs.writeFileSync(path.join(dir, 'keep.txt'), 'not in the update');
  return dir;
}
const newFiles = (pkg, extra = {}) => ({
  'package.json': Buffer.from(JSON.stringify(pkg)),
  'src/main/main.js': Buffer.from('new main'),
  'src/renderer/index.html': Buffer.from('new page'),
  ...extra,
});

test('applyUpdate replaces the files, keeps a backup and leaves other files alone', () => {
  const dir = appDir();
  const bk = `${dir}-bk`;
  assert.deepEqual(u.applyUpdate(dir, newFiles({ ...PKG, version: '0.2.0' }, { 'scripts/new.js': Buffer.from('n') }), bk), { version: '0.2.0', needsInstall: false });
  assert.equal(fs.readFileSync(path.join(dir, 'src', 'main', 'main.js'), 'utf8'), 'new main');
  assert.equal(fs.readFileSync(path.join(dir, 'scripts', 'new.js'), 'utf8'), 'n');
  assert.equal(fs.readFileSync(path.join(bk, 'src', 'main', 'main.js'), 'utf8'), 'old main');
  assert.equal(fs.readFileSync(path.join(dir, 'keep.txt'), 'utf8'), 'not in the update');
  assert.equal(fs.existsSync(path.join(dir, '.needs-install')), false);
});

test('applyUpdate flags an engine reinstall when the dependencies change', () => {
  const dir = appDir();
  assert.equal(u.applyUpdate(dir, newFiles({ ...PKG, version: '0.3.0', devDependencies: { electron: '^45.0.0' } }), `${dir}-bk`).needsInstall, true);
  assert.ok(fs.existsSync(path.join(dir, '.needs-install')));
});

test('applyUpdate refuses a different or incomplete app, and changes nothing', () => {
  const dir = appDir();
  assert.throws(() => u.applyUpdate(dir, newFiles({ ...PKG, name: 'something-else' }), `${dir}-bk`), /wrongapp/);
  const noPage = newFiles(PKG);
  delete noPage['src/renderer/index.html'];
  assert.throws(() => u.applyUpdate(dir, noPage, `${dir}-bk`), /incomplete/);
  assert.throws(() => u.applyUpdate(dir, { 'x.js': Buffer.from('x') }, `${dir}-bk`), /nopkg/);
  assert.equal(fs.readFileSync(path.join(dir, 'src', 'main', 'main.js'), 'utf8'), 'old main');
});

test('applyUpdate removes files the last update installed that the new version dropped, and nothing else', () => {
  const dir = appDir();
  const bk = `${dir}-bk`;
  fs.mkdirSync(path.join(dir, 'old'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'old', 'gone.js'), 'dropped');
  fs.mkdirSync(path.join(dir, 'node_modules', 'electron'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'electron', 'index.js'), 'engine');
  const outside = path.join(path.dirname(dir), `${path.basename(dir)}-outside.txt`);
  fs.writeFileSync(outside, 'not the app’s');
  fs.writeFileSync(path.join(dir, '.pd-files.json'), JSON.stringify(['package.json', 'old/gone.js', `../${path.basename(outside)}`, outside, 'node_modules/electron/index.js', 42, null]));
  u.applyUpdate(dir, newFiles({ ...PKG, version: '0.2.0' }), bk);
  assert.equal(fs.existsSync(path.join(dir, 'old')), false, 'the dropped file and its empty folder went');
  assert.equal(fs.readFileSync(path.join(bk, 'old', 'gone.js'), 'utf8'), 'dropped', 'kept in the backup');
  assert.ok(fs.existsSync(outside), 'nothing outside the app folder');
  assert.ok(fs.existsSync(path.join(dir, 'node_modules', 'electron', 'index.js')), 'the app engine stays');
  assert.ok(fs.existsSync(path.join(dir, 'keep.txt')));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, '.pd-files.json'), 'utf8')).sort(), ['package.json', 'src/main/main.js', 'src/renderer/index.html']);
});

test('downloadTo saves a download with progress', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-dl-'));
  const chunks = [Buffer.from('abc'), Buffer.from('defg')];
  const fetchFn = async () => ({
    ok: true,
    headers: { get: () => '7' },
    body: { getReader: () => ({ read: async () => (chunks.length ? { done: false, value: chunks.shift() } : { done: true }) }) },
  });
  const seen = [];
  const file = await u.downloadTo(fetchFn, 'https://x/a', path.join(dir, 'a.bin'), (p) => seen.push(+p.toFixed(2)));
  assert.equal(fs.readFileSync(file, 'utf8'), 'abcdefg');
  assert.deepEqual(seen, [0.43, 1]);
  await assert.rejects(u.downloadTo(async () => ({ ok: false, status: 404 }), 'https://x/b', path.join(dir, 'b')), /download 404/);
});
