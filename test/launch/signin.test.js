const test = require('node:test');
const assert = require('node:assert/strict');
const { launchApp, until } = require('./app');

test('first open asks to sign in, then shows the dashboard', { timeout: 60000 }, async () => {
  const a = await launchApp({ signedIn: false, seed: false });
  try {
    await until(a.win, () => !document.querySelector('#welcome').hidden, 'the welcome screen');
    assert.match(await a.win.textContent('#welcome h1'), /emote & badge/);
    await a.win.click('[data-action="login"]');
    await until(a.win, () => document.querySelector('#welcome .spinner'), 'signing in');
    await until(a.win, () => !document.querySelector('#app').hidden, 'the dashboard', 20000);
    await until(a.win, () => document.querySelector('#hero .hero-title'), 'a stream being farmed', 20000);
    assert.equal(await a.win.textContent('.user-btn span'), 'pearfarmer');
    assert.deepEqual(a.errors, []);
  } finally {
    await a.close();
  }
});
