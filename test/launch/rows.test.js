// The queue's rows against the stand-in Kick: a drop limited to certain channels (Cozy Hours: three
// channels of an event in Just Chatting; Closing Bell Cup: two in Market Hours; Skyforge Dev Diary:
// one) has a row of its own, named after the drop and pictured by its channels, with its own switch
// and place in the order. Just Chatting keeps a row for its open drop.
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchApp, until } = require('./app');

let a;
test.before(async () => {
  a = await launchApp({ size: { width: 1280, height: 800 } });
  await a.farming();
  await a.win.click('[data-action="side-tab"][data-id="queue"]');
  await until(a.win, () => document.querySelector('.cat[data-cat-id="ev:cozy-hours"]'), 'the Cozy Hours row');
});
test.after(async () => {
  assert.deepEqual(a.errors, []);
  await a.close();
});

const row = (id) => `.cat[data-cat-id="${id}"]`;
const settings = () => a.win.evaluate(() => state.settings);

test('a channel row: its channels\' avatars, the drop\'s name, whose channels and where, and how many are live', async () => {
  const cozy = row('ev:cozy-hours');
  assert.equal(await a.win.locator(`${cozy} .row-art.many .av`).count(), 2, 'two avatars');
  assert.equal((await a.win.textContent(`${cozy} .row-art .more`)).trim(), '+1');
  assert.equal((await a.win.textContent(`${cozy} .cat-name > span`)).trim(), 'Cozy Hours');
  const meta = await a.win.textContent(`${cozy} .cat-meta`);
  assert.match(meta, /NightOwl, LofiLane \+1 · Just Chatting/);
  assert.match(meta, /2 of 3 live/);
  // Just Chatting keeps its own row, for its open drop only.
  assert.equal((await a.win.textContent(`${row(802)} .cat-name > span`)).trim(), 'Just Chatting');
  assert.equal(await a.win.locator(`${row(802)} img.cat-art`).count(), 1);
  // One channel: its avatar with the category's art as a badge, and "live now".
  const solo = row('ch:9104');
  assert.equal(await a.win.locator(`${solo} .row-art.one .cat-badge`).count(), 1);
  assert.equal((await a.win.textContent(`${solo} .cat-name > span`)).trim(), 'Skyforge Dev Diary');
  assert.match(await a.win.textContent(`${solo} .cat-meta`), /Tidepool · Skyforge Arena.*live now/);
});

test('a channel row with none of its channels live says so, and Market Hours has no row of its own', async () => {
  const market = row('ch:9109,9111');
  await until(a.win, (s) => document.querySelector(`${s} .chip.amber`)?.textContent.trim() === 'Offline', 'Offline', 10000, market);
  assert.equal(await a.win.getAttribute(`${market} .chip.amber`, 'data-tip'), 'None of its 2 channels is live');
  assert.match(await a.win.textContent(`${market} .cat-meta`), /Driftwood & SolarFlair · Market Hours/);
  assert.equal(await a.win.locator(row(805)).count(), 0, 'its only drop is channel-only');
});

test('opened, a channel row lists its channels, each with a live dot', async () => {
  await a.win.click(`${row('ev:cozy-hours')} .cat-row`);
  await until(a.win, () => document.querySelectorAll('.cat[data-cat-id="ev:cozy-hours"] .row-chan').length === 3, 'its three channels');
  const live = await a.win.$$eval('.cat[data-cat-id="ev:cozy-hours"] .row-chan.live', (els) => els.map((e) => e.textContent.trim()).sort());
  assert.deepEqual(live, ['LofiLane', 'NightOwl']);
  await a.win.click(`${row('ev:cozy-hours')} .cat-row`);
});

test('its switch and its place in the order are its own, apart from its category\'s', async () => {
  await a.win.click(`${row('ev:cozy-hours')} [data-action="cat-toggle"]`);
  await until(a.win, () => state.settings.disabledCategories.includes('ev:cozy-hours'), 'switched off');
  assert.ok(!(await settings()).disabledCategories.includes(802), 'Just Chatting stays on');
  await until(a.win, () => document.querySelector('.cat[data-cat-id="ev:cozy-hours"]').classList.contains('disabled'), 'shown off');
  assert.ok(!(await a.win.locator(row(802)).getAttribute('class')).includes('disabled'));
  await a.win.click(`${row('ev:cozy-hours')} [data-action="cat-toggle"]`);
  await until(a.win, () => !state.settings.disabledCategories.includes('ev:cozy-hours'), 'on again');

  // Moved up one: the saved order holds its id, and Just Chatting's place doesn't change with it.
  const before = await a.win.$$eval('.cat[data-cat-id]', (els) => els.map((e) => e.dataset.catId));
  const at = before.indexOf('ch:9109,9111');
  await a.win.hover(`${row('ch:9109,9111')} .cat-row`);
  await a.win.click(`${row('ch:9109,9111')} [data-action="cat-up"]`);
  await until(a.win, (want) => state.settings.categoryOrder.indexOf('ch:9109,9111') === want, 'the new order saved', 10000, at - 1);
  const after = await a.win.$$eval('.cat[data-cat-id]', (els) => els.map((e) => e.dataset.catId));
  assert.equal(after.indexOf('ch:9109,9111'), at - 1);
  assert.deepEqual(after.filter((id) => id !== 'ch:9109,9111' && id !== before[at - 1]), before.filter((id) => id !== 'ch:9109,9111' && id !== before[at - 1]));
});

test('the tray\'s Up next lists rows the same way', async () => {
  await a.demo((d) => d.openTray());
  let pop;
  for (let i = 0; i < 40 && !pop; i++) {
    pop = a.app.windows().find((x) => x.url().endsWith('tray.html'));
    await a.win.waitForTimeout(150);
  }
  await until(pop, () => document.querySelector('.tray-next .tray-cat'), 'Up next');
  const rows = await pop.$$eval('.tray-next .tray-cat', (els) => els.map((e) => [e.querySelector('b').textContent, !!e.querySelector('.row-art'), e.querySelector(':scope > span:last-child')?.textContent]));
  const cozy = rows.find(([name]) => name === 'Cozy Hours');
  assert.ok(cozy, 'Cozy Hours is up next');
  assert.equal(cozy[1], true, 'with its channels\' avatars');
  assert.equal(cozy[2], '2 of 3 live');
});

test('the dashboard still fits a small window without scrolling', async () => {
  const over = await a.win.evaluate(() => document.scrollingElement.scrollHeight - innerHeight);
  assert.ok(over <= 2, `scrolls by ${over}px`);
});
