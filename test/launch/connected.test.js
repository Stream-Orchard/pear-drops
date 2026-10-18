// Settings › Connected apps, with a stand-in Stream Multiview linked through Grapevine in a folder
// of the test's own: the card in each state, the credit banner naming it, and History.
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchApp, until } = require('./app');

const MV = 'com.glowingpear.streammultiview';
let a;
test.before(async () => {
  a = await launchApp({ size: { width: 1480, height: 940 } });
  await a.farming();
});
test.after(async () => {
  await a.demo((d) => d.multiview({ stop: true }));
  assert.deepEqual(a.errors, []);
  await a.close();
});

const card = () => a.win.textContent('.app-card');
const openTab = async () => {
  if (!(await a.win.locator('.settings-modal').count())) await a.win.click('button.icon-only[data-action="settings"]');
  await a.win.click('[data-action="settings-tab"][data-id="apps"]');
  await until(a.win, () => document.querySelector('.app-card img.app-logo'), 'the card, with its logo');
};

test('off to start with, and nothing listens; not installed shows a Download button, said once', async () => {
  await openTab();
  assert.match(await card(), /Stream Multiview/);
  assert.equal(await a.app.evaluate(() => global.pdDebug.connected.state().running), false);
  // Demo mode starts with no (stand-in) Stream Multiview installed.
  await until(a.win, () => document.querySelector('.app-card [data-action="open-link"].primary'), 'the Download button');
  assert.match(await card(), /Not installed/);
  assert.equal(await a.win.locator('.app-card .app-link').count(), 0, 'no Download page link as well');
  assert.match(await a.win.getAttribute('.app-card .btn.primary', 'data-url'), /^https:\/\/github\.com\/GlowingPear\/stream-window-multiview\/releases\/latest$/);
  await a.demo((d) => d.multiview({ stop: true })); // installed now, not running
  await until(a.win, () => /Off\. Nothing listens until you switch it on\./.test(document.querySelector('.app-card').textContent), 'Off');
  const [scroll, client] = await a.win.evaluate(() => {
    const el = document.querySelector('.settings-pane .modal-section');
    return [el.scrollHeight, el.clientHeight];
  });
  assert.ok(scroll <= client, `the tab fits without scrolling (${scroll} > ${client})`);
});

test('switched on: waiting, then connected to Stream Multiview, with its players and the pairing date', async () => {
  await openTab();
  await a.demo((d) => d.multiview({ stop: true })); // installed, not running
  await a.win.click('.app-card [data-action="connected-toggle"]');
  await until(a.win, () => /isn’t open, or its Connect switch is off/.test(document.querySelector('.app-card')?.textContent ?? ''), 'waiting');
  assert.ok(await a.win.locator('.app-card .switch.on').count());
  assert.equal(await a.app.evaluate(() => global.pdDebug.store.get().connectedApps['com.glowingpear.streammultiview'].enabled), true);
  await a.demo((d) => d.multiview({ signedIn: false, mode: 'auto' }));
  await until(a.win, () => document.querySelector('.app-card.connected'), 'connected', 15000);
  await until(a.win, () => /signed out while you farm/.test(document.querySelector('.app-card').textContent), 'its players');
  assert.match(await card(), /Connected · 0\.4\.0/);
  assert.match(await card(), /Paired (\d+ \w+|\w+ \d+)/, 'the date in the computer’s own order (18 Oct, Oct 18)');
  // The stand-in heard what's being farmed, made-up channel and all.
  const heard = await until(
    a.win,
    () => true,
    'ready',
  ).then(() => a.app.evaluate(() => global.pdDemo.multiviewPeer.link.request('com.streamorchard.peardrops', 'drops.farming.get')));
  assert.equal(heard.state, 'farming');
  assert.ok(heard.channel.slug);
  assert.equal(heard.account.platform, 'kick');
  // Enough for a widget: the drop's rewards, each with its state, in the order they unlock.
  assert.ok(heard.drop.rewards.items.length >= 1);
  for (const r of heard.drop.rewards.items) assert.ok(['claimed', 'ready', 'locked'].includes(r.state), r.state);
  const order = heard.drop.rewards.items.map((r) => r.required);
  assert.deepEqual(order, [...order].sort((x, y) => x - y));
  for (const pic of [heard.channel.avatar, heard.drop.image, ...heard.drop.rewards.items.map((r) => r.image)].filter(Boolean)) assert.match(pic, /^https:\/\//, 'pictures as Kick gives them');
  // Test: a round trip, said on the card for a moment.
  await openTab();
  await a.win.click('.app-card [data-action="connected-test"]');
  await until(a.win, () => document.querySelector('.app-foot.ok'), 'the test result', 10000);
  assert.match(await a.win.textContent('.app-foot .app-line'), /^Stream Multiview 0\.4\.0 answered in \d+ ms$/);
  // A change on the card replaces the test's answer at once.
  await a.demo((d) => d.multiview({ signedIn: true, mode: 'signed-in' }));
  await until(a.win, () => document.querySelector('.app-foot.warn'), 'the new warning, not the old test answer', 10000);
  await a.demo((d) => d.multiview({ signedIn: false, mode: 'auto' }));
  await until(a.win, () => /signed out while you farm/.test(document.querySelector('.app-foot')?.textContent ?? ''), 'back to the usual line', 15000);
  // A click on its widget brings Pear Drops forward.
  assert.deepEqual(await a.app.evaluate(() => global.pdDemo.multiviewPeer.link.request('com.streamorchard.peardrops', 'drops.farming.show')), { shown: true });
});

test('players that stay signed in: a warning on the card, and the credit banner names Stream Multiview', async () => {
  await a.demo((d) => d.multiview({ signedIn: true, mode: 'signed-in' }));
  await until(a.win, () => document.querySelector('.app-foot.warn'), 'the warning', 15000);
  assert.match(await a.win.textContent('.app-foot'), /stay signed in, so they can take your drop credit/);
  await a.win.keyboard.press('Escape');
  await a.demo((d) => d.conflict(true));
  // Watch events with no credit, until there are enough for the banner (3).
  for (let i = 0; i < 8 && (await a.app.evaluate(() => global.pdDebug.farmer.eventsSinceCredit)) < 3; i++) await a.demo((d) => d.credit());
  await until(a.win, () => /Stream Multiview has Kick players open that are signed in/.test(document.querySelector('#banner')?.textContent ?? ''), 'the banner', 10000);
  await a.win.click('#banner [data-action="open-connected-apps"]');
  await until(a.win, () => document.querySelector('.settings-tab.active[data-id="apps"]'), 'Connected apps opened from the banner');
  await a.win.keyboard.press('Escape');
  await a.demo((d) => d.conflict(false));
  await a.demo((d) => d.credit());
  await until(a.win, () => !document.querySelector('#banner .banner'), 'the banner to clear', 10000);
});

test('Activity: every message between the two this run, in words, a page at a time that fits', async () => {
  await openTab();
  await until(a.win, () => document.querySelector('.app-card.connected'), 'connected', 15000);
  await a.win.click('.app-card [data-action="act-open-app"]');
  await until(a.win, () => document.querySelectorAll('.act-row').length >= 3, 'the log');
  const text = () => a.win.textContent('.act-list');
  // What Pear Drops told it, what it said back, and the link itself.
  await until(a.win, () => /drops\.farming\.changed/.test(document.querySelector('.act-list').textContent), 'what was farmed, sent');
  assert.match(await a.win.textContent('.act-who'), /Stream Multiview/);
  assert.match(await a.win.textContent('.modal-head h3'), /^Activity$/);
  const totals = await a.win.textContent('.act-stats');
  assert.match(totals, /Sent[^]*\d/);
  assert.ok(await a.win.locator('.act-chart svg .act-bar-out').count(), 'sent messages in the chart');
  // Received only: Stream Multiview's players, from this run.
  await a.win.click('[data-action="act-filter"][data-id="in"]');
  await until(a.win, () => [...document.querySelectorAll('.act-row:not(.act-marker)')].every((r) => r.classList.contains('in')), 'only received');
  await until(a.win, () => /players\.changed/.test(document.querySelector('.act-list').textContent), 'its players');
  assert.match(await text(), /Kick players? open/);
  // A message's fields.
  await a.win.click('.act-row.in >> nth=0');
  await until(a.win, () => document.querySelector('.act-detail .act-fields dt, .act-detail .act-hidden'), 'its fields');
  // Never more than fits, and the page doesn't scroll.
  const [content, box] = await a.win.evaluate(() => {
    const p = document.querySelector('.settings-pane');
    return [p.scrollHeight, p.clientHeight];
  });
  assert.ok(content <= box + 1, `the Activity view needs ${content - box}px of scrolling`);
  const list = await a.win.evaluate(() => {
    const l = document.querySelector('.act-list');
    return l.scrollHeight - l.clientHeight;
  });
  assert.ok(list <= 1, `the log's rows fit (${list}px over)`);
  // All, and Older pages back in time when there's more than a page.
  await a.win.click('[data-action="act-filter"][data-id="all"]');
  await until(a.win, () => /of \d+/.test(document.querySelector('.act-range')?.textContent ?? ''), 'the range');
  const [shown, total] = await a.win.evaluate(() => document.querySelector('.act-range').textContent.match(/(\d+)–(\d+) of (\d+)/).slice(2).map(Number));
  if (total > shown) {
    await a.win.click('[data-action="act-older"]');
    await until(a.win, () => /^\d+–/.test(document.querySelector('.act-range').textContent) && !document.querySelector('.act-range').textContent.startsWith('1–'), 'the next page');
    await a.win.click('[data-action="act-newest"]');
    await until(a.win, () => document.querySelector('.act-range').textContent.startsWith('1–'), 'back to the newest');
  }
  // Esc goes back to the cards, then closes Settings.
  await a.win.keyboard.press('Escape');
  await until(a.win, () => document.querySelector('.app-card') && !document.querySelector('.act-list'), 'the cards again');
  await a.win.click('.app-card [data-action="act-open-app"]');
  await until(a.win, () => document.querySelector('.act-list'), 'the log again');
  await a.win.click('.modal-head [data-action="act-close"]');
  await until(a.win, () => document.querySelector('.app-card'), 'back by the arrow');
  assert.deepEqual(a.errors, []);
});

test('farming stops with its players out on Auto: the log and the card say they sign back in after a few minutes', async () => {
  await a.demo((d) => d.multiview({ signedIn: false, mode: 'auto' }));
  await openTab();
  await until(a.win, () => /signed out while you farm/.test(document.querySelector('.app-foot')?.textContent ?? ''), 'its players, on Auto', 15000);
  await a.win.evaluate(() => window.pd.pause(true));
  await until(a.win, () => /sign back in a few minutes after farming stops/.test(document.querySelector('.app-foot').textContent), 'the card line', 10000);
  await a.win.click('.app-card [data-action="act-open-app"]');
  const marker = '.act-marker:has(.act-pill [d="M12 7v5l3 2"])';
  await until(a.win, (sel) => document.querySelector(sel), 'the clock marker', 10000, marker);
  assert.equal(await a.win.textContent(`${marker} .act-pill`), 'Farming stopped · Kick players sign back in after a few minutes');
  assert.match(await a.win.textContent('.act-list'), /2 Kick players open, signed out while Pear Drops farms/);
  await a.win.evaluate(() => window.pd.pause(false));
  await until(a.win, () => /Farming again · Kick players stay signed out/.test(document.querySelector('.act-list').textContent), 'farming again', 10000);
  await a.win.click('.modal-head [data-action="act-close"]');
  await until(a.win, () => /signed out while you farm/.test(document.querySelector('.app-foot')?.textContent ?? ''), 'the usual line again', 10000);
  await a.farming();
});

test('Disconnect forgets the pairing and switches it off; History has the link coming and going', async () => {
  await openTab();
  await until(a.win, () => document.querySelector('.app-card [data-action="connected-disconnect"]'), 'Disconnect');
  await a.win.click('.app-card [data-action="connected-disconnect"]');
  await until(a.win, () => document.querySelector('.app-card.off'), 'off again');
  assert.equal(await a.app.evaluate(() => global.pdDebug.connected.state().running), false);
  assert.equal(await a.app.evaluate((_e, id) => global.pdDebug.connected.link.keys.get(id), MV), null);
  const types = await a.win.evaluate(async () => (await window.pd.history({ range: 'all' })).events.map((e) => e.type));
  for (const t of ['link-connected', 'link-unpaired']) assert.ok(types.includes(t), t);
});
