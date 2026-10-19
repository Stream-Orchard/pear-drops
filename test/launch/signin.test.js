const test = require('node:test');
const assert = require('node:assert/strict');
const { launchApp, until } = require('./app');

test('first open asks to sign in, then shows the dashboard; signing out closes Kick’s pages, and in again opens them', { timeout: 60000 }, async () => {
  const a = await launchApp({ signedIn: false, seed: false });
  try {
    await until(a.win, () => !document.querySelector('#welcome').hidden, 'the welcome screen');
    assert.match(await a.win.textContent('#welcome h1'), /emote & badge/);
    await a.win.click('[data-action="login"]');
    await until(a.win, () => document.querySelector('#welcome .spinner'), 'signing in');
    await until(a.win, () => !document.querySelector('#app').hidden, 'the dashboard', 20000);
    await until(a.win, () => document.querySelector('#hero .hero-title'), 'a stream being farmed', 20000);
    assert.equal(await a.win.textContent('.user-btn span'), 'pearfarmer');
    // Sign out: Kick's pages close first, so none of them writes the login back while it's wiped.
    assert.ok(await a.app.evaluate(() => !!global.pdDebug.watcher.view), 'the player is open');
    await a.win.evaluate(() => window.pd.logout());
    await until(a.win, () => !document.querySelector('#welcome').hidden, 'the welcome screen again', 10000);
    assert.equal(await a.app.evaluate(() => global.pdDebug.watcher.view), null, 'the player closed');
    assert.equal(await a.app.evaluate(() => global.pdDebug.watcher.chatView), null, 'and its chat');
    // And in again: the player comes back.
    await a.win.click('[data-action="login"]');
    await until(a.win, () => document.querySelector('#hero .hero-title'), 'farming again', 20000);
    let back = false;
    for (let i = 0; i < 80 && !back; i++) back = (await a.app.evaluate(() => !!global.pdDebug.watcher.view)) || (await a.win.waitForTimeout(250), false);
    assert.ok(back, 'the player is back');
    assert.deepEqual(a.errors, []);
  } finally {
    await a.close();
  }
});
