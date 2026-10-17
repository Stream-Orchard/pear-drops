const test = require('node:test');
const assert = require('node:assert/strict');
const { launchApp, until } = require('./app');

let a;
test.before(async () => {
  a = await launchApp({ size: { width: 1512, height: 944 } });
  await a.farming();
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

test('weeks of history show daily activity with "When you farm"; the last 24 hours show by the hour without it', async () => {
  await until(a.win, () => document.querySelector('.hist-chart-card .card-title')?.textContent.includes('Daily activity'), 'daily activity');
  assert.equal(await a.win.locator('.hist-hours').count(), 1);
  await a.win.click('[data-action="hist-range"][data-id="24h"]');
  await until(a.win, () => document.querySelector('.hist-chart-card .card-title')?.textContent.includes('Activity by hour'), 'activity by hour');
  assert.equal(await a.win.locator('.hist-hours').count(), 0, '"When you farm" would only repeat it');
  assert.ok(await a.win.locator('.hist-daily-chart .axis.today', { hasText: 'Now' }).count(), 'the current hour is marked');
  await a.win.click('[data-action="hist-range"][data-id="7d"]');
  await until(a.win, () => document.querySelector('.hist-chart-card .card-title')?.textContent.includes('Daily activity'), 'by day again');
});

test('watch sessions show the stream title under the streamer, cut to one line, with all of it on hover', async () => {
  await a.win.click('[data-action="hist-table"][data-id="sessions"]');
  await until(a.win, () => document.querySelector('.htable .sess-title'), 'a session title');
  const t = await a.win.evaluate(() => {
    const el = document.querySelector('.htable .sess-title');
    return { text: el.textContent, tip: el.dataset.tip, lines: Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight || '14')), clip: getComputedStyle(el).textOverflow };
  });
  assert.ok(t.text.length > 0);
  assert.equal(t.tip, t.text, 'hover shows the whole title');
  assert.equal(t.clip, 'ellipsis');
  assert.ok(t.lines <= 1, 'one line');
  await a.win.click('[data-action="hist-table"][data-id="timeline"]');
});
