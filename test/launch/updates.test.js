// Settings › Updates against a stand-in GitHub: finding a new version with its notes,
// installing it into a throwaway copy of the app folder, and the "Updated" card.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchApp, until } = require('./app');
const { makeZip, standInGitHub } = require('./github');

const REPO = 'pearfarmer/kick-drops';
const PKG = { name: 'kick-drops-client', version: '0.1.0', main: 'src/main/main.js' };
let gh;
let a;
let appRoot;

test.before(async () => {
  appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kdf-approot-'));
  fs.writeFileSync(path.join(appRoot, 'package.json'), JSON.stringify(PKG));
  const zip = makeZip([
    ['pearfarmer-kick-drops-abc/package.json', JSON.stringify({ ...PKG, version: '0.2.0' })],
    ['pearfarmer-kick-drops-abc/src/main/main.js', 'new main'],
    ['pearfarmer-kick-drops-abc/src/renderer/index.html', 'new page'],
  ]);
  gh = await standInGitHub({
    repo: REPO,
    zip,
    release: {
      tag_name: 'v0.2.0',
      name: 'v0.2.0',
      published_at: new Date().toISOString(),
      html_url: `https://github.com/${REPO}/releases/tag/v0.2.0`,
      body: '- Done tab',
      body_html: '<h2>Highlights</h2><ul><li>A <strong>Done</strong> tab for finished and missed drops</li><li>Updates from GitHub, <a href="https://github.com/pearfarmer/kick-drops">right in the app</a></li></ul><script>window.__pwned = 1</script><img src="javascript:alert(1)">',
      assets: [],
    },
  });
  a = await launchApp({
    size: { width: 1512, height: 944 },
    // An older version ran before: this start is the first of a new version.
    files: { 'updates.json': { seenVersion: '0.0.9', auto: false } },
    env: { KDF_UPDATE_API: gh.url, KDF_UPDATE_APP_ROOT: appRoot },
  });
  await until(a.win, () => document.querySelector('#hero .hero-title'), 'farming to start', 20000);
});
test.after(async () => {
  assert.deepEqual(a.errors, []);
  await a.close();
  await gh.close();
});

test('the first start of a new version shows what’s new, once', async () => {
  await until(a.win, () => document.querySelector('.modal.whatsnew'), 'the Updated card');
  assert.match(await a.win.textContent('.modal.whatsnew'), /Updated from 0\.0\.9/);
  assert.ok(await a.win.locator('.wn-list li').count(), 'this version’s changes');
  await a.win.screenshot({ path: path.join(os.tmpdir(), 'kdf-whatsnew.png') });
  await a.win.click('.modal.whatsnew [data-action="close-whatsnew"].btn');
  await until(a.win, () => !document.querySelector('.modal.whatsnew'), 'the card to close');
  const saved = JSON.parse(fs.readFileSync(path.join(a.data, 'updates.json'), 'utf8'));
  assert.equal(saved.seenVersion, '0.1.0');
});

test('Settings › Updates: saving a repository finds the new version and its notes, safely', async () => {
  await a.win.click('button.icon-only[data-action="settings"]');
  await a.win.click('[data-action="settings-tab"][data-id="updates"]');
  await until(a.win, () => document.querySelector('.upd-hero'), 'the Updates pane');
  assert.match(await a.win.textContent('.upd-hero'), /Updates switch on once/);
  assert.ok(await a.win.locator('.upd-timeline > li').count(), 'the changelog timeline');
  await a.win.fill('.upd-repo input', `https://github.com/${REPO}`);
  await a.win.click('.upd-repo .btn');
  await until(a.win, () => /Version\s+0\.2\.0 is out/.test(document.querySelector('.upd-state')?.textContent ?? ''), 'the new version');
  assert.match(await a.win.textContent('.upd-notes'), /Done tab for finished/);
  assert.equal(await a.win.locator('.upd-notes script, .upd-notes img').count(), 0, 'scripts and unsafe images are stripped');
  assert.equal(await a.win.evaluate(() => window.__pwned), undefined);
  assert.equal(await a.win.locator('.tb-update').count(), 1, 'a chip in the title bar');
  await a.win.screenshot({ path: path.join(os.tmpdir(), 'kdf-updates.png') });
});

test('installing copies the new version into the app folder and offers a restart', async () => {
  await a.win.click('[data-action="update-install"]');
  await until(a.win, () => document.querySelector('.upd-hero [data-action="update-restart"]'), 'Restart now', 20000);
  assert.equal(fs.readFileSync(path.join(appRoot, 'src', 'main', 'main.js'), 'utf8'), 'new main');
  assert.equal(JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')).version, '0.2.0');
  assert.match(await a.win.textContent('.tb-update'), /Update ready/);
  await a.win.screenshot({ path: path.join(os.tmpdir(), 'kdf-updates-ready.png') });
});
