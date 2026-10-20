// Kick's daily reward against the stand-in Kick: the chest in the title bar and the tray, its card,
// claiming it with the reveal (on the dashboard and in the tray), Replay, the claim setting, and
// History. Every number and card is made up.
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchApp, until, readDb } = require('./app');

let a;
test.before(async () => {
  a = await launchApp({ size: { width: 1280, height: 800 } });
  await a.farming();
  await until(a.win, () => document.querySelector('#titlebar-actions .dr-chest.state-earning'), 'the chest');
});
test.after(async () => {
  assert.deepEqual(a.errors, []);
  await a.close();
});

const chest = '#titlebar-actions .dr-chest';
const events = () => readDb(a.data, (db) => db.events().map((r) => r.e));
const claimDone = (page) => until(page, () => document.querySelector('.dr-card.state-claimed') && !document.querySelector('.dr-card.revealing'), 'the claimed card', 40000);
async function tray() {
  await a.demo((d) => d.openTray());
  for (let i = 0; i < 40; i++) {
    const w = a.app.windows().find((x) => x.url().endsWith('tray.html'));
    if (w) return w;
    await a.win.waitForTimeout(150);
  }
  throw new Error('no tray popover');
}

test('earning: a ring fills around the chest, and its tooltip says the minutes', async () => {
  const ring = await a.win.evaluate((sel) => {
    const v = document.querySelector(`${sel} .dr-ring-value`);
    return { dash: Number(v.getAttribute('stroke-dasharray')), off: Number(v.getAttribute('stroke-dashoffset')) };
  }, chest);
  assert.ok(Math.abs(1 - ring.off / ring.dash - 37 / 60) < 0.01, 'the ring shows 37 of 60 minutes');
  assert.match(await a.win.getAttribute(chest, 'data-tip'), /37 of 60 min\n23 min to go/);
  // The chest sits in its ring's centre.
  const [dx, dy] = await a.win.evaluate((sel) => {
    const c = (q) => {
      const r = document.querySelector(q).getBoundingClientRect();
      return [r.x + r.width / 2, r.y + r.height / 2];
    };
    const [x1, y1] = c(`${sel} .dr-ring`);
    const [x2, y2] = c(`${sel} .chest-box`);
    return [Math.abs(x1 - x2), Math.abs(y1 - y2)];
  }, chest);
  assert.ok(dx < 0.6 && dy < 0.6, `centred (${dx}, ${dy})`);
});

test('the card opens under the chest, fits the window without scrolling, and closes on a click elsewhere or Esc', async () => {
  await a.win.click(chest);
  await until(a.win, () => document.querySelector('.dr-pop .dr-card.state-earning'), 'the card');
  const fit = await a.win.evaluate(() => {
    const pop = document.querySelector('.dr-pop');
    const r = pop.getBoundingClientRect();
    const c = document.querySelector('#titlebar-actions .dr-chest').getBoundingClientRect();
    // Where it's placed, not where its opening animation has it now.
    return { bottom: r.bottom, vh: innerHeight, right: parseFloat(pop.style.left) + r.width, vw: innerWidth, scroll: pop.scrollHeight - pop.clientHeight, notch: parseFloat(pop.style.left) + parseFloat(pop.style.getPropertyValue('--notch')) - (c.left + c.width / 2) };
  });
  assert.ok(fit.bottom <= fit.vh && fit.right <= fit.vw, 'inside the window');
  assert.equal(fit.scroll, 0);
  assert.ok(Math.abs(fit.notch) < 1, 'its notch points at the chest');
  const text = await a.win.textContent('.dr-pop');
  assert.match(text, /37 of 60 min/);
  assert.match(text, /12-day streak/);
  assert.match(text, /Level 42/);
  assert.match(text, /Welcome Reward/);
  assert.equal(await a.win.isDisabled('.dr-pop .dr-claim'), true);
  assert.match(await a.win.textContent('.dr-pop .dr-claim'), /Claim in 23 min/);
  await a.win.mouse.click(300, 400);
  await until(a.win, () => !document.querySelector('.dr-pop'), 'closed by a click elsewhere');
  await a.win.click(chest);
  await until(a.win, () => document.querySelector('.dr-pop'), 'open again');
  await a.win.keyboard.press('Escape');
  await until(a.win, () => !document.querySelector('.dr-pop'), 'closed by Esc');
});

test('ready: the chest becomes a "Claim reward" chip and hops, and claiming plays the reveal', async () => {
  await a.app.evaluate(() => global.pdDemo.daily({ minutes: 60, winner: 'card-rare-0' }));
  await until(a.win, () => document.querySelector('#titlebar-actions .dr-chest.state-ready.chip'), 'the chip');
  assert.equal((await a.win.textContent(chest)).trim(), 'Claim reward');
  assert.equal(await a.win.evaluate((sel) => getComputedStyle(document.querySelector(`${sel} .chest-box`)).animationName, chest), 'dr-hop');
  await a.win.click(chest);
  await until(a.win, () => document.querySelector('.dr-pop .dr-card.state-ready'), 'the ready card');
  await a.win.click('.dr-pop .dr-claim');
  await until(a.win, () => document.querySelector('.dr-reveal')?.dataset.phase === 'spin', 'the reel', 15000);
  // The reel stops on the winner, under the mark.
  await until(a.win, () => document.querySelector('.dr-reveal')?.dataset.phase === 'handoff', 'the reel stopping', 20000);
  const off = await a.win.evaluate(() => {
    const won = document.querySelector('.dr-tile.won').getBoundingClientRect();
    const mark = document.querySelector('.dr-reel-mark').getBoundingClientRect();
    return Math.abs(won.x + won.width / 2 - (mark.x + mark.width / 2));
  });
  assert.ok(off < 1, `the winner under the mark (${off}px off)`);
  await claimDone(a.win);
  assert.match(await a.win.textContent('.dr-pop .dr-result'), /Rare emote\s*New/);
  assert.match(await a.win.textContent('.dr-pop .dr-actions'), /Replay/);
  assert.equal(await a.win.getAttribute('.dr-pop .dr-won-card', 'alt'), 'Rare emote');
  const claim = events().find((e) => e.type === 'daily-reward');
  assert.equal(claim.text, 'Rare emote, new to your collection');
  assert.equal(claim.by, 'you');
  await a.win.keyboard.press('Escape');
  // Claimed: a full ring in the card's colour.
  await until(a.win, () => document.querySelector('#titlebar-actions .dr-chest.state-claimed.r-rare'), 'the claimed chest');
});

test('Replay plays the reel again, and Collection opens Kick’s own page', async () => {
  await a.win.click(chest);
  await a.win.click('.dr-pop [data-action="reward-replay"]');
  await until(a.win, () => document.querySelector('.dr-card.revealing'), 'the reel again');
  await claimDone(a.win);
  await a.win.click('.dr-pop [data-action="reward-collection"]');
  assert.ok((await a.app.evaluate(() => global.pdOpened)).includes('https://kick.com/collectibles'));
  await a.win.keyboard.press('Escape');
});

test('the tray: the chest at the top right opens the card, and a claim plays right there', async () => {
  await a.app.evaluate(() => global.pdDemo.daily({ minutes: 60, winner: 'card-common-0' }));
  const pop = await tray();
  await until(pop, () => document.querySelector('.tray-head .dr-chest.state-ready'), 'the ready chest');
  const head = await pop.evaluate(() => {
    const h = document.querySelector('.tray-head').getBoundingClientRect();
    const c = document.querySelector('.tray-head .dr-chest').getBoundingClientRect();
    return { right: h.right - c.right, dy: Math.abs(h.y + h.height / 2 - (c.y + c.height / 2)) };
  });
  assert.ok(head.right < 1 && head.dy < 1, 'top right, centred on the header');
  await pop.click('.tray-head .dr-chest');
  await until(pop, () => document.querySelector('.dr-card.at-tray.state-ready'), 'the card in the tray');
  await pop.click('.dr-claim');
  await until(pop, () => document.querySelector('.dr-reveal')?.dataset.phase === 'celebrate', 'the winner', 40000);
  assert.match(await pop.textContent('.dr-winner-caption'), /Common emote\s*Duplicate/, 'the reveal says it’s a duplicate');
  await claimDone(pop);
  assert.match(await pop.textContent('.dr-result'), /You already have this\s*Common emote/);
  assert.match(await pop.textContent('.dr-result'), /\+12m watch time to Level 43/);
  // The popover is as tall as the card: nothing cut off.
  const fits = await pop.evaluate(() => document.querySelector('.dr-actions').getBoundingClientRect().bottom <= innerHeight);
  assert.ok(fits);
  assert.equal(events().filter((e) => e.type === 'daily-reward').length, 2);
  await pop.click('[data-action="reward-back"]');
  await until(pop, () => document.querySelector('.tray-now'), 'back to farming');
});

test('the claim setting is in Settings › Farming, and the two notification kinds are there', async () => {
  await a.win.click('button.icon-only[data-action="settings"]');
  await until(a.win, () => document.querySelector('[data-key="dailyClaim"]'), 'the setting');
  assert.match(await a.win.textContent('[data-key="dailyClaim"].active'), /Before it resets/);
  await a.win.click('[data-key="dailyClaim"][data-id="self"]');
  await until(a.win, () => state.settings.dailyClaim === 'self', 'saved');
  await a.win.click('[data-action="settings-tab"][data-id="notifications"]');
  const kinds = await a.win.$$eval('.notify-kind', (els) => els.map((e) => e.dataset.kind));
  assert.ok(kinds.includes('dailyReady') && kinds.includes('dailyClaimed'));
  assert.equal(kinds.length % 2, 0, 'the tiles stay even');
  assert.equal(await a.win.evaluate(() => document.querySelector('.settings-pane .modal-section').scrollHeight - document.querySelector('.settings-pane .modal-section').clientHeight), 0);
  await a.win.keyboard.press('Escape');
});

test('History shows each claim, with its card', async () => {
  await a.win.click('[data-action="view"][data-id="history"]');
  await until(a.win, () => [...document.querySelectorAll('td')].some((td) => /Rare emote, new to your collection/.test(td.textContent)), 'the claim in the timeline');
  await a.win.click('[data-action="view"][data-id="dashboard"]');
});
