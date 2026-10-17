// A small window (a 13" laptop's maximized window): every panel adapts, so nothing scrolls and
// nothing is cut to a letter or runs off the edge.
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchApp, until } = require('./app');

let a;
test.before(async () => {
  a = await launchApp({ size: { width: 1280, height: 775 } });
  await a.farming();
});
test.after(async () => {
  assert.deepEqual(a.errors, []);
  await a.close();
});

/** Elements whose text is cut short (wider than their box). */
const cut = (selectors) =>
  a.win.evaluate((sel) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent && e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim().slice(0, 30)), selectors);

test('the dashboard fits a 1280×775 window: no page scrolling, and names and labels whole', async () => {
  await a.win.waitForTimeout(800);
  const over = await a.win.evaluate(() => document.querySelector('#content').scrollHeight - document.querySelector('#content').clientHeight);
  assert.ok(over <= 1, `the dashboard scrolls by ${over}px`);
  assert.deepEqual(await cut('#hero .reward-name, #stats .stat-head, #stats .stat-foot > span, .side-tab, #side .cat-name > span'), []);
  const tabs = await a.win.evaluate(() => { const t = document.querySelector('.side-tabs'); return t.scrollWidth - t.clientWidth; });
  assert.ok(tabs <= 1, `the side tabs run ${tabs}px off the edge`);
});

test('History fits too, with its table no wider than its card', async () => {
  await a.win.click('[data-action="view"][data-id="history"]');
  await until(a.win, () => document.querySelector('.hist-kpis .stat'), 'the history view');
  await a.win.waitForTimeout(600);
  const m = await a.win.evaluate(() => {
    const h = document.querySelector('#history');
    const body = document.querySelector('.hist-table-body');
    const head = document.querySelector('.hist-table-head');
    return { over: h.scrollHeight - h.clientHeight, sideways: body.scrollWidth - body.clientWidth, head: head.scrollWidth - head.clientWidth };
  });
  assert.ok(m.over <= 2, `History scrolls by ${m.over}px`);
  assert.ok(m.sideways <= 1, `the table scrolls sideways by ${m.sideways}px`);
  assert.ok(m.head <= 1, `the table's filters run ${m.head}px off the edge`);
  assert.deepEqual(await cut('#history .stat-foot > span'), []);
  await a.win.click('[data-action="view"][data-id="dashboard"]');
});
