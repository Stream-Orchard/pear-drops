const test = require('node:test');
const assert = require('node:assert/strict');
const { launchApp, until } = require('./app');

let a;
test.before(async () => {
  a = await launchApp({ size: { width: 1512, height: 944 } });
  await until(a.win, () => document.querySelector('#hero .hero-title'), 'farming to start', 20000);
  await a.win.click('[data-action="view"][data-id="history"]');
  await until(a.win, () => document.querySelector('.hist-kpis .stat'), 'the history view');
});
test.after(async () => {
  assert.deepEqual(a.errors, []);
  await a.close();
});

test('the overview totals a week of history', async () => {
  assert.equal(await a.win.locator('.hist-kpis .stat').count(), 6);
  assert.match(await a.win.textContent('.hist-kpis'), /Watch time/);
  assert.ok(await a.win.locator('.hist-daily-chart svg').count());
  assert.ok((await a.win.locator('.drop-item').count()) >= 3);
  assert.ok((await a.win.locator('.htable tbody tr').count()) > 5);
  const scroll = await a.win.evaluate(() => { const c = document.querySelector('#history'); return c.scrollHeight - c.clientHeight; });
  assert.ok(scroll <= 2, `the history view fits without scrolling (${scroll}px over)`);
});

test('focusing a drop shows its own progress, sessions and totals', async () => {
  await a.win.click('.drop-item >> nth=0');
  await until(a.win, () => document.querySelector('.hist-series-chart svg'), 'the drop progress chart');
  assert.match(await a.win.textContent('.hist-title h2'), /Neon Rush Launch Week/);
  await a.win.click('[data-action="hist-table"][data-id="sessions"]');
  await until(a.win, () => document.querySelectorAll('.htable tbody tr').length > 2, 'watch sessions');
  assert.match(await a.win.textContent('.htable'), /Efficiency/i);
  await a.win.click('.clear-chip');
  await until(a.win, () => /History/.test(document.querySelector('.hist-title h2')?.textContent), 'all drops again');
});

test('timeline filters by group and by search', async () => {
  await a.win.click('[data-action="hist-table"][data-id="timeline"]');
  await a.win.click('[data-action="hist-group"][data-id="problems"]');
  await until(a.win, () => [...document.querySelectorAll('.htable tbody tr')].every((r) => r.className === 'ev-problems'), 'only problems');
  await a.win.click('[data-action="hist-group"][data-id="problems"]');
  await a.win.fill('#hist-search', 'nightowl');
  await until(a.win, () => { const rows = [...document.querySelectorAll('.htable tbody tr')]; return rows.length && rows.every((r) => /NightOwl/i.test(r.textContent)); }, 'search results');
});
