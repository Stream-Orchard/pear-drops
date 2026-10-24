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
/** The prize stays on show until Done: presses it, and waits for the card. */
async function done(page) {
  await until(page, () => document.querySelector('.dr-reveal')?.dataset.phase === 'celebrate', 'the prize', 40000);
  await page.click('.dr-reveal .dr-done');
  await until(page, () => !document.querySelector('.dr-card.revealing'), 'back to the card');
}
async function claimDone(page) {
  await done(page);
  await until(page, () => document.querySelector('.dr-card.state-claimed'), 'the claimed card');
}
/** The tray's popover, open (the icon's click toggles it: open already, it would close). */
async function tray() {
  await a.demo((d) => d.openTray());
  for (let i = 0; i < 40; i++) {
    const w = a.app.windows().find((x) => x.url().endsWith('tray.html'));
    if (w) {
      if (await a.app.evaluate(() => global.pdDebug.tray.window.isVisible())) return w;
      // It was open, so that closed it: once more (a click just after it hides doesn't count).
      await a.win.waitForTimeout(300);
      await a.demo((d) => d.openTray());
    }
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
  assert.doesNotMatch(text, /Welcome Reward/, 'it waits on Kick’s sign-up steps, which no link reaches: nothing to do here');
  assert.equal(await a.win.isDisabled('.dr-pop .dr-claim'), true);
  assert.match(await a.win.textContent('.dr-pop .dr-claim'), /Claim in 23 min/);
  await a.win.mouse.click(300, 400);
  await until(a.win, () => !document.querySelector('.dr-pop'), 'closed by a click elsewhere');
  await a.win.click(chest);
  await until(a.win, () => document.querySelector('.dr-pop'), 'open again');
  await a.win.keyboard.press('Escape');
  await until(a.win, () => !document.querySelector('.dr-pop'), 'closed by Esc');
});

test('opening the card asks Kick again, so it shows the minutes as they are now', async () => {
  // Kick's count moves on between checks; the last check was a while ago.
  await a.app.evaluate(() => {
    global.pdDemo.api.daily.minutes = 41;
    global.pdDemo.dailyReward().checkedAt = 0;
  });
  await a.win.click(chest);
  await until(a.win, () => /41 of 60 min/.test(document.querySelector('.dr-pop')?.textContent ?? ''), 'the minutes from Kick, on opening');
  await a.win.keyboard.press('Escape');
  await until(a.win, () => !document.querySelector('.dr-pop'), 'closed');
  await a.demo((d) => d.daily({ minutes: 37 }));
});

test('ready: the chest becomes a "Claim reward" chip and hops, and claiming plays the reveal', async () => {
  await a.app.evaluate(() => global.pdDemo.daily({ minutes: 60, winner: 'card-rare-0' }));
  await until(a.win, () => document.querySelector('#titlebar-actions .dr-chest.state-ready.chip'), 'the chip');
  assert.equal((await a.win.textContent(chest)).trim(), 'Claim reward');
  assert.equal(await a.win.evaluate((sel) => getComputedStyle(document.querySelector(`${sel} .chest-box`)).animationName, chest), 'dr-hop');
  await a.win.click(chest);
  await until(a.win, () => document.querySelector('.dr-pop .dr-card.state-ready'), 'the ready card');
  await a.win.click('.dr-pop .dr-claim');
  // Demo mode's own crate opens: the lid swings back on its hinge and stays on (its underside rises
  // from the box's top edge), and the light stays over the crate, inside the card (it once turned
  // about the drawing's corner and flew off its edge).
  await until(a.win, () => document.querySelector('.dr-reveal')?.dataset.phase === 'openBox', 'the crate opening');
  await a.win.waitForTimeout(1500);
  const open = await a.win.evaluate(() => {
    const r = (sel) => document.querySelector(`.dr-unbox ${sel}`).getBoundingClientRect();
    const layer = document.querySelector('.dr-reveal').getBoundingClientRect();
    const [body, face, lid, glow] = [r('.crate-body > rect'), r('.crate-lid'), r('.crate-lid-open'), r('.crate-burst')];
    const mid = (x) => x.x + x.width / 2;
    return {
      faceFolded: face.height < 1,
      lidOn: Math.abs(lid.bottom - body.top) < 3 && Math.abs(mid(lid) - mid(body)) < 2,
      lidUp: lid.height > body.height * 0.4,
      glowCentred: Math.abs(mid(glow) - mid(body)) < 2,
      inside: glow.left >= layer.left - 1 && glow.right <= layer.right + 1,
    };
  });
  assert.deepEqual(open, { faceFolded: true, lidOn: true, lidUp: true, glowCentred: true, inside: true });
  await until(a.win, () => document.querySelector('.dr-reveal')?.dataset.phase === 'spin', 'the reel', 15000);
  // The reel stops on the winner, under the mark.
  await until(a.win, () => document.querySelector('.dr-reveal')?.dataset.phase === 'handoff', 'the reel stopping', 20000);
  const off = await a.win.evaluate(() => {
    const won = document.querySelector('.dr-tile.won').getBoundingClientRect();
    const mark = document.querySelector('.dr-reel-mark').getBoundingClientRect();
    return Math.abs(won.x + won.width / 2 - (mark.x + mark.width / 2));
  });
  assert.ok(off < 1, `the winner under the mark (${off}px off)`);
  // The prize stays until Done (it once went back to the card after a moment).
  await until(a.win, () => document.querySelector('.dr-reveal')?.dataset.phase === 'celebrate', 'the prize', 20000);
  await a.win.waitForTimeout(3500);
  assert.equal(await a.win.evaluate(() => document.querySelector('.dr-reveal')?.dataset.phase), 'celebrate', 'still showing the prize');
  assert.equal(await a.win.isVisible('.dr-reveal .dr-done'), true);
  await claimDone(a.win);
  assert.match(await a.win.textContent('.dr-pop .dr-result'), /Rare emote\s*New/);
  assert.match(await a.win.textContent('.dr-pop .dr-actions'), /Replay/);
  assert.equal(await a.win.getAttribute('.dr-pop .dr-won-card', 'alt'), 'Rare emote');
  const claim = events().find((e) => e.type === 'daily-reward');
  assert.equal(claim.text, 'Rare emote, new to your collection');
  assert.equal(claim.by, 'you');
  await a.win.keyboard.press('Escape');
  // Claimed: just the chest, in the card's colour, no ring.
  await until(a.win, () => document.querySelector('#titlebar-actions .dr-chest.state-claimed.r-rare'), 'the claimed chest');
  assert.equal(await a.win.locator('#titlebar-actions .dr-chest .dr-ring').count(), 0);
});

test('Replay plays the reel again, and Collection opens Kick’s own page', async () => {
  await a.win.click(chest);
  await a.win.click('.dr-pop [data-action="reward-replay"]');
  await until(a.win, () => document.querySelector('.dr-card.revealing'), 'the reel again');
  // Esc ends the reveal first, then closes the card.
  await until(a.win, () => document.querySelector('.dr-reveal')?.dataset.phase === 'celebrate', 'the prize', 40000);
  await a.win.keyboard.press('Escape');
  await until(a.win, () => !document.querySelector('.dr-card.revealing') && document.querySelector('.dr-pop'), 'back to the card, still open');
  await a.win.click('.dr-pop [data-action="reward-collection"]');
  assert.ok((await a.app.evaluate(() => global.pdOpened)).includes('https://kick.com/collectibles'));
  await a.win.keyboard.press('Escape');
});

test('the Welcome Reward shows once it can be claimed, and claims from the card', async () => {
  await a.app.evaluate(() => global.pdDemo.daily({ welcome: 'claimable', winner: 'card-uncommon-1' }));
  await a.win.click(chest);
  await until(a.win, () => /Welcome Reward\s*Ready to open/.test(document.querySelector('.dr-pop .dr-crate-row')?.textContent ?? ''), 'the Welcome Reward, ready');
  await a.win.click('.dr-pop .dr-crate-row [data-action="reward-claim"]');
  await done(a.win);
  await until(a.win, () => !document.querySelector('.dr-pop .dr-crate-row'), 'claimed, and gone from the card (a one-off)');
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
  assert.ok(await pop.evaluate(() => document.querySelector('.dr-done').getBoundingClientRect().bottom <= innerHeight), 'Done fits the popover');
  await claimDone(pop);
  assert.match(await pop.textContent('.dr-result'), /You already have this\s*Common emote/);
  assert.match(await pop.textContent('.dr-result'), /\+12m watch time to Level 43/);
  // The popover is as tall as the card: nothing cut off.
  const fits = await pop.evaluate(() => document.querySelector('.dr-actions').getBoundingClientRect().bottom <= innerHeight);
  assert.ok(fits);
  assert.equal(events().filter((e) => e.type === 'daily-reward').length, 3, 'the daily one, the Welcome Reward, and this');
  await pop.click('[data-action="reward-back"]');
  await until(pop, () => document.querySelector('.tray-now'), 'back to farming');
});

// ------------------------------------------------------------------ an event's crate

const crateRow = '.dr-pop .dr-crate-row';

test('an event’s crate filling: its own row, in its colours, with the time to go', async () => {
  await a.app.evaluate(() => global.pdDemo.daily({ event: 112, eventName: 'Harvest Moon' }));
  await a.win.click(chest);
  await until(a.win, () => document.querySelector('.dr-pop .dr-crate-row.state-earning'), 'the crate’s row');
  assert.match(await a.win.textContent(crateRow), /Harvest Moon\s*1h 08m to go/);
  assert.match(await a.win.getAttribute(crateRow, 'class'), /theme-event/, 'a name with no season: the plain event colours');
  assert.match(await a.win.getAttribute(crateRow, 'data-tip'), /A new one every day until/);
  assert.equal(await a.win.evaluate(() => document.querySelector('.dr-pop').scrollHeight - document.querySelector('.dr-pop').clientHeight), 0, 'the card still fits');
  await a.win.keyboard.press('Escape');
});

test('an event’s crate ready: the title bar’s chest hops in its colours with its name, and its row shimmers', async () => {
  await a.app.evaluate(() => global.pdDemo.daily({ event: 180, eventName: 'Trick or Treat', eventWinner: 'prize-3' }));
  await until(a.win, () => document.querySelector('#titlebar-actions .dr-chest.crate.state-ready.chip.theme-halloween'), 'the event’s chip');
  await a.win.waitForTimeout(300); // its colour's transition
  assert.equal((await a.win.textContent(chest)).trim(), 'Trick or Treat');
  assert.match(await a.win.getAttribute(chest, 'data-tip'), /Trick or Treat is ready\. Claim before/);
  const look = await a.win.evaluate((sel) => {
    const c = document.querySelector(sel);
    return { hop: getComputedStyle(c.querySelector('.chest-box')).animationName, glow: getComputedStyle(c).animationName, colour: getComputedStyle(c).color };
  }, chest);
  assert.deepEqual(look, { hop: 'dr-hop', glow: 'dr-glow-ev', colour: 'rgb(255, 122, 26)' });
  await a.win.click(chest);
  await until(a.win, () => document.querySelector('.dr-pop .dr-crate-row.state-ready'), 'the ready row');
  const row = await a.win.evaluate((sel) => {
    const r = document.querySelector(sel);
    return { hop: getComputedStyle(r.querySelector('.chest-box')).animationName, edge: getComputedStyle(r, '::before').animationName, text: r.textContent };
  }, crateRow);
  assert.equal(row.hop, 'dr-hop');
  assert.equal(row.edge, 'dr-run');
  assert.match(row.text, /Trick or Treat\s*Ready to open\s*Claim before/);
});

test('claiming an event’s crate: it opens onto its prize, which stays until Done, then the row shows it with See it', async () => {
  await a.win.click(`${crateRow} [data-action="reward-claim"]`);
  await until(a.win, () => document.querySelector('.dr-reveal.crate.theme-halloween')?.dataset.phase === 'openBox', 'the crate opening, in its colours');
  await until(a.win, () => document.querySelector('.dr-reveal')?.dataset.phase === 'celebrate', 'the prize', 15000);
  assert.equal(await a.win.evaluate(() => 'instant' in document.querySelector('.dr-reveal').dataset), true, 'no reel');
  assert.match(await a.win.textContent('.dr-winner-title'), /Trick or Treat/);
  assert.match(await a.win.textContent('.dr-winner-caption'), /Rare reward\s*New/);
  assert.equal(await a.win.getAttribute('.dr-winner .dr-won-card', 'alt'), 'Rare reward');
  await a.win.waitForTimeout(3000);
  assert.equal(await a.win.evaluate(() => document.querySelector('.dr-reveal')?.dataset.phase), 'celebrate', 'still showing the prize');
  await a.win.click('.dr-reveal .dr-done');
  await until(a.win, () => document.querySelector('.dr-pop .dr-crate-row.state-claimed') && !document.querySelector('.dr-card.revealing'), 'the claimed row');
  assert.match(await a.win.textContent(crateRow), /Trick or Treat\s*Rare reward\s*New\s*See it/);
  assert.equal(await a.win.locator(`${crateRow} .dr-crate-prize img`).count(), 1, 'its prize’s picture');
  await until(a.win, () => !document.querySelector('#titlebar-actions .dr-chest.crate'), 'the chest back to the daily one');
  const claim = events().findLast((e) => e.type === 'daily-reward');
  assert.deepEqual([claim.text, claim.crate, claim.by], ['Trick or Treat: Rare reward, new to your collection', 'Trick or Treat', 'you']);
  // See it: the same prize again.
  await a.win.click(`${crateRow} [data-action="reward-replay"]`);
  await until(a.win, () => document.querySelector('.dr-reveal')?.dataset.phase === 'celebrate', 'the prize again', 15000);
  assert.match(await a.win.textContent('.dr-winner-caption'), /Rare reward/);
  await a.win.click('.dr-reveal .dr-done');
  await until(a.win, () => !document.querySelector('.dr-card.revealing'), 'back to the card');
  await a.win.keyboard.press('Escape');
});

test('the tray: an event’s crate waiting makes its chest hop, and claims with the reveal right there', async () => {
  await a.app.evaluate(() => global.pdDemo.daily({ event: 180, eventName: 'Holiday Cheer', eventWinner: 'prize-0' }));
  const pop = await tray();
  await until(pop, () => document.querySelector('.tray-head .dr-chest.crate.state-ready.theme-winter'), 'the event’s chest');
  assert.equal(await pop.evaluate(() => getComputedStyle(document.querySelector('.tray-head .dr-chest .chest-box')).animationName), 'dr-hop');
  await pop.click('.tray-head .dr-chest');
  await until(pop, () => document.querySelector('.dr-card.at-tray .dr-crate-row.state-ready'), 'its row');
  await pop.click('.dr-crate-row [data-action="reward-claim"]');
  await until(pop, () => document.querySelector('.dr-reveal')?.dataset.phase === 'celebrate', 'the prize', 15000);
  assert.ok(await pop.evaluate(() => document.querySelector('.dr-done').getBoundingClientRect().bottom <= innerHeight), 'Done fits the popover');
  // Back ends the reveal first.
  await pop.click('[data-action="reward-back"]');
  await until(pop, () => document.querySelector('.dr-crate-row.state-claimed') && !document.querySelector('.dr-card.revealing'), 'the claimed row');
  await pop.click('[data-action="reward-back"]');
  await until(pop, () => document.querySelector('.tray-now'), 'back to farming');
  await a.demo((d) => d.daily({ event: null }));
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
