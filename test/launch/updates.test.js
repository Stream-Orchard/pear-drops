// Settings › Updates against a stand-in GitHub: finding a new version with its notes,
// installing it into a throwaway copy of the app folder, and the "Updated" card.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchApp, until, readDb } = require('./app');
const { makeZip, standInGitHub } = require('./github');

const REPO = 'pearfarmer/pear-drops';
const PKG = { name: 'pear-drops', version: '0.1.0', main: 'src/main/main.js' };
let gh;
let a;
let appRoot;

test.before(async () => {
  appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-approot-'));
  fs.writeFileSync(path.join(appRoot, 'package.json'), JSON.stringify(PKG));
  const zip = makeZip([
    ['pearfarmer-pear-drops-abc/package.json', JSON.stringify({ ...PKG, version: '0.2.0' })],
    ['pearfarmer-pear-drops-abc/src/main/main.js', 'new main'],
    ['pearfarmer-pear-drops-abc/src/renderer/index.html', 'new page'],
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
      body_html: '<h2>Highlights</h2><ul><li>A <strong>Done</strong> tab for finished and missed drops</li><li>Updates from GitHub, <a href="https://github.com/pearfarmer/pear-drops">right in the app</a></li></ul><script>window.__pwned = 1</script><img src="javascript:alert(1)">',
      assets: [],
    },
  });
  a = await launchApp({
    size: { width: 1512, height: 944 },
    // An older version ran before (it kept this in a file, copied into the database): this start is the first of a new version.
    files: { 'updates.json': { seenVersion: '0.0.9', auto: false } },
    env: { PD_UPDATE_API: gh.url, PD_UPDATE_APP_ROOT: appRoot },
  });
  await a.farming();
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
  await a.win.screenshot({ path: path.join(os.tmpdir(), 'pd-whatsnew.png') });
  await a.win.click('.modal.whatsnew [data-action="close-whatsnew"].btn');
  await until(a.win, () => !document.querySelector('.modal.whatsnew'), 'the card to close');
  const saved = readDb(a.data, (db) => db.get('updates'));
  assert.equal(saved.seenVersion, require('../../package.json').version, 'the version that is running');
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
  await a.win.screenshot({ path: path.join(os.tmpdir(), 'pd-updates.png') });
});

test('installing copies the new version into the app folder and offers a restart', async () => {
  await a.win.click('[data-action="update-install"]');
  await until(a.win, () => document.querySelector('.upd-hero [data-action="update-restart"]'), 'Restart now', 20000);
  assert.equal(fs.readFileSync(path.join(appRoot, 'src', 'main', 'main.js'), 'utf8'), 'new main');
  assert.equal(JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')).version, '0.2.0');
  assert.match(await a.win.textContent('.tb-update'), /Update ready/);
  await a.win.screenshot({ path: path.join(os.tmpdir(), 'pd-updates-ready.png') });
});

test('updates from a repository other than the one the app was built from carry a warning, and one click goes back', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-approot-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ ...PKG, updateRepo: 'pearorchard/pear-drops' }));
  const b = await launchApp({
    size: { width: 1512, height: 944 },
    files: { 'updates.json': { seenVersion: require('../../package.json').version, auto: false, repo: REPO } },
    env: { PD_UPDATE_API: gh.url, PD_UPDATE_APP_ROOT: root },
  });
  try {
    await b.farming();
    await b.win.click('button.icon-only[data-action="settings"]');
    await b.win.click('[data-action="settings-tab"][data-id="updates"]');
    await until(b.win, () => document.querySelector('.upd-warn'), 'the warning');
    assert.match(await b.win.textContent('.upd-warn'), /isn’t Pear Drops’ own repository\. The app installs whatever it releases/);
    const [content, box] = await b.win.evaluate(() => {
      const p = document.querySelector('.settings-pane');
      return [p.scrollHeight, p.clientHeight];
    });
    assert.ok(content <= box + 1, `the Updates tab needs ${content - box}px of scrolling`);
    await b.win.screenshot({ path: path.join(os.tmpdir(), 'pd-updates-elsewhere.png') });
    await b.win.click('.upd-warn [data-action="update-home-repo"]');
    await until(b.win, () => !document.querySelector('.upd-warn'), 'the warning to go');
    assert.equal(await b.win.inputValue('.upd-repo input'), 'pearorchard/pear-drops');
    // The same repository, written differently, is no stranger.
    await b.win.fill('.upd-repo input', 'PearOrchard/Pear-Drops');
    await b.win.click('.upd-repo .btn');
    await b.win.waitForTimeout(300);
    assert.equal(await b.win.locator('.upd-warn').count(), 0);
    assert.deepEqual(b.errors, []);
  } finally {
    await b.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
