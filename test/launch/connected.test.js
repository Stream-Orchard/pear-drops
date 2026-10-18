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
  assert.match(await card(), /Paired \d+ \w+/);
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
