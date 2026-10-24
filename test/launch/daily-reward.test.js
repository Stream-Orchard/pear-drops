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
  assert.equal(await a.win.locator('.dr-pop .dr-tabs').count(), 0, 'one crate: no tabs');
  assert.equal(await a.win.isDisabled('.dr-pop .dr-claim'), true);
  assert.match(await a.win.textContent('.dr-pop .dr-claim'), /Claim in 23 min/);
  // Filling: the label on a face that never changes; the progress below it and round the chest.
  const fill = await a.win.evaluate(() => {
    const b = document.querySelector('.dr-pop .dr-claim.fill');
    return { line: parseFloat(b.querySelector('.dr-claim-line > i').style.width), face: getComputedStyle(b).backgroundColor, ring: !!b.querySelector('.dr-claim-ring .val') };
  });
  assert.deepEqual(fill, { line: 61.7, face: 'rgb(18, 21, 26)', ring: true });
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

test('the Welcome Reward gets a tab once it can be claimed, opens on it, and claims from there', async () => {
  await a.app.evaluate(() => global.pdDemo.daily({ welcome: 'claimable', winner: 'card-uncommon-1' }));
  await a.win.click(chest);
  await until(a.win, () => document.querySelector('.dr-pop .dr-tab.on.state-ready')?.textContent.includes('Welcome Reward'), 'its tab, open');
  assert.match(await a.win.textContent('.dr-pop .dr-subline'), /Welcome Reward/);
  await a.win.click('.dr-pop .dr-claim');
  await done(a.win);
  await until(a.win, () => !document.querySelector('.dr-pop .dr-tabs') && document.querySelector('.dr-pop .dr-card.state-claimed'), 'claimed: a one-off, gone, so the daily card alone');
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

const tab = (id) => `.dr-pop .dr-tab[data-id="${id}"]`;

test('an event’s crate filling: a tab of its own, in its colours; its page says its words, its time and what it has given', async () => {
  await a.app.evaluate(() => global.pdDemo.daily({ event: 112, eventName: 'Harvest Moon', eventPast: 2, eventDays: 8 }));
  await a.win.click(chest);
  await until(a.win, () => document.querySelectorAll('.dr-pop .dr-tab').length === 2, 'the tabs');
  assert.equal(await a.win.getAttribute('.dr-pop .dr-tab.on', 'data-id'), 'daily-demo', 'nothing ready: the daily one');
  assert.deepEqual(await a.win.$$eval('.dr-pop .dr-tab', (els) => els.map((e) => e.textContent.trim())), ['Daily', 'Harvest Moon']);
  await a.win.click(tab('event-demo'));
  await until(a.win, () => document.querySelector('.dr-pop .dr-card.crate.state-earning'), 'its page');
  assert.match(await a.win.getAttribute('.dr-pop .dr-card', 'class'), /theme-event/, 'a name with no season: the plain event colours');
  const text = await a.win.textContent('.dr-pop .dr-card');
  assert.match(text, /Harvest Moon\s*Resets at/);
  assert.match(text, /Open the Harvest Moon crate every day/, 'its description');
  assert.match(text, /1h 52m of 3h/);
  assert.match(text, /3h a day/);
  assert.match(text, /New one daily until/);
  assert.match(await a.win.textContent('.dr-pop .dr-claim'), /Claim in 1h 08m/);
  assert.match(await a.win.textContent('.dr-pop .dr-won'), /Won this event\s*2\s*2 of 8 days/);
  const tiles = await a.win.$$eval('.dr-pop .dr-won-tile', (els) => els.map((e) => (e.classList.contains('empty') ? '' : e.querySelector('small').textContent)));
  assert.equal(tiles.length, 8, 'a slot a day');
  assert.equal(tiles[0], 'Yesterday');
  assert.deepEqual(tiles.slice(2), ['', '', '', '', '', ''], 'the days still to come');
  assert.match(await a.win.getAttribute('.dr-pop .dr-won-tile', 'data-tip'), /^[A-Z][\w ]+ · \w+ (emote|badge) · Yesterday$/);
  assert.equal(await a.win.evaluate(() => document.querySelector('.dr-pop').scrollHeight - document.querySelector('.dr-pop').clientHeight), 0, 'the card still fits');
  await a.win.keyboard.press('Escape');
});

test('an event’s crate ready: the title bar’s chip; the card opens on its tab, which glows, and its Claim is in its colours', async () => {
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
  await until(a.win, () => document.querySelector('.dr-pop .dr-tab.on[data-id="event-demo"]') && document.querySelector('.dr-pop .dr-card.crate.state-ready'), 'its tab, open');
  const claim = await a.win.evaluate(() => {
    const b = document.querySelector('.dr-pop .dr-claim');
    const t = document.querySelector('.dr-pop .dr-tab[data-id="event-demo"]');
    return {
      ready: b.classList.contains('ready') && b.classList.contains('theme-halloween'),
      label: getComputedStyle(b).color,
      edge: getComputedStyle(b, '::before').animationName,
      hop: getComputedStyle(b.querySelector('.chest-box')).animationName,
      tab: getComputedStyle(t).animationName,
      tabHop: getComputedStyle(t.querySelector('.chest-box')).animationName,
    };
  });
  assert.deepEqual(claim, { ready: true, label: 'rgb(20, 10, 6)', edge: 'dr-run', hop: 'dr-hop', tab: 'dr-glow-ev', tabHop: 'dr-hop' });
  // The daily tab, and back: the event's keeps glowing meanwhile.
  await a.win.click(tab('daily-demo'));
  await until(a.win, () => document.querySelector('.dr-pop .dr-card:not(.crate).state-claimed'), 'the daily page');
  assert.match(await a.win.getAttribute(tab('event-demo'), 'class'), /state-ready/);
  await a.win.click(tab('event-demo'));
  await until(a.win, () => document.querySelector('.dr-pop .dr-card.crate.state-ready'), 'the event’s page again');
});

test('claiming an event’s crate: its prize, named from Kick’s rewards list, stays until Done; then its page shows it', async () => {
  await a.win.click('.dr-pop .dr-claim');
  await until(a.win, () => document.querySelector('.dr-reveal.crate.theme-halloween')?.dataset.phase === 'openBox', 'the crate opening, in its colours');
  await until(a.win, () => document.querySelector('.dr-reveal')?.dataset.phase === 'celebrate', 'the prize', 15000);
  assert.equal(await a.win.evaluate(() => 'instant' in document.querySelector('.dr-reveal').dataset), true, 'no reel');
  assert.match(await a.win.textContent('.dr-winner-title'), /Trick or Treat/);
  assert.match(await a.win.textContent('.dr-winner-caption'), /Full Moon\s*Rare badge\s*New/);
  assert.equal(await a.win.getAttribute('.dr-winner .dr-won-card', 'alt'), 'Full Moon');
  await a.win.waitForTimeout(3000);
  assert.equal(await a.win.evaluate(() => document.querySelector('.dr-reveal')?.dataset.phase), 'celebrate', 'still showing the prize');
  await a.win.click('.dr-reveal .dr-done');
  await until(a.win, () => document.querySelector('.dr-pop .dr-card.crate.state-claimed') && !document.querySelector('.dr-card.revealing'), 'its page, claimed: it stays on its tab');
  assert.match(await a.win.textContent('.dr-pop .dr-result'), /Full Moon\s*Rare badge\s*New/);
  assert.match(await a.win.textContent('.dr-pop .dr-subline'), /Trick or Treat\s*Next one in/);
  assert.equal(await a.win.locator(`${tab('event-demo')} .dr-tab-prize img`).count(), 1, 'its tab shows the prize');
  assert.match(await a.win.textContent('.dr-pop .dr-won'), /Won this event\s*1/);
  assert.equal(await a.win.textContent('.dr-pop .dr-won-tile small'), 'Today');
  await until(a.win, () => !document.querySelector('#titlebar-actions .dr-chest.crate'), 'the chest back to the daily one');
  const claim = events().findLast((e) => e.type === 'daily-reward');
  assert.deepEqual([claim.text, claim.reward, claim.crate, claim.by], ['Trick or Treat: Full Moon, rare badge, new to your collection', 'Full Moon', 'Trick or Treat', 'you']);
  // Replay: the same prize again. View on Kick: its rewards page.
  await a.win.click('.dr-pop [data-action="reward-replay"]');
  await until(a.win, () => document.querySelector('.dr-reveal')?.dataset.phase === 'celebrate', 'the prize again', 15000);
  assert.match(await a.win.textContent('.dr-winner-caption'), /Full Moon/);
  await a.win.click('.dr-reveal .dr-done');
  await until(a.win, () => !document.querySelector('.dr-card.revealing'), 'back to the card');
  await a.win.click('.dr-pop [data-action="reward-prizes"]');
  assert.ok((await a.app.evaluate(() => global.pdOpened)).includes('https://kick.com/drops/rewards'));
  await a.win.keyboard.press('Escape');
  // Nothing ready now: it opens on the daily tab.
  await a.win.click(chest);
  await until(a.win, () => document.querySelector('.dr-pop .dr-tab.on[data-id="daily-demo"]'), 'the daily tab');
  await a.win.keyboard.press('Escape');
});

test('both ready: the card opens on the daily one first', async () => {
  await a.app.evaluate(() => global.pdDemo.daily({ minutes: 60, event: 180, eventName: 'Trick or Treat' }));
  await a.win.click(chest);
  await until(a.win, () => document.querySelector('.dr-pop .dr-tab.on[data-id="daily-demo"]') && document.querySelector('.dr-pop .dr-card.state-ready'), 'the daily tab, ready');
  assert.match(await a.win.getAttribute(tab('event-demo'), 'class'), /state-ready/, 'the event’s waits, glowing');
  assert.match(await a.win.getAttribute('.dr-pop .dr-claim', 'class'), /ready theme-daily/);
  await a.win.keyboard.press('Escape');
  await a.demo((d) => d.daily({ claimed: true, event: null }));
});

test('a crate that gives watch time: the reveal and its page say how much, towards which level', async () => {
  await a.app.evaluate(() => global.pdDemo.daily({ event: 180, eventName: 'Winter Wonderland', eventWinner: 'xp' }));
  await a.win.click(chest);
  await until(a.win, () => document.querySelector('.dr-pop .dr-card.crate.theme-winter.state-ready'), 'its page, in winter colours');
  await a.win.click('.dr-pop .dr-claim');
  await until(a.win, () => document.querySelector('.dr-reveal')?.dataset.phase === 'celebrate', 'the prize', 15000);
  assert.match(await a.win.textContent('.dr-winner'), /\+30 min\s*watch time/);
  assert.match(await a.win.textContent('.dr-winner-caption'), /Level progress\s*towards Level 43/);
  await a.win.click('.dr-reveal .dr-done');
  await until(a.win, () => document.querySelector('.dr-pop .dr-card.crate.state-claimed') && !document.querySelector('.dr-card.revealing'), 'its page, claimed');
  assert.match(await a.win.textContent('.dr-pop .dr-stage'), /\+30 min\s*watch time/);
  assert.match(await a.win.textContent('.dr-pop .dr-result'), /Level progress\s*\+30 min watch time towards Level 43/);
  assert.equal(events().findLast((e) => e.type === 'daily-reward').text, 'Winter Wonderland: +30 min watch time to Level 43');
  await a.win.keyboard.press('Escape');
});

test('the tray: an event’s crate waiting makes its chest hop; its tab opens, and claims with the reveal right there', async () => {
  await a.app.evaluate(() => global.pdDemo.daily({ event: 180, eventName: 'Holiday Cheer', eventWinner: 'gift-4' }));
  const pop = await tray();
  await until(pop, () => document.querySelector('.tray-head .dr-chest.crate.state-ready.theme-winter'), 'the event’s chest');
  assert.equal(await pop.evaluate(() => getComputedStyle(document.querySelector('.tray-head .dr-chest .chest-box')).animationName), 'dr-hop');
  await pop.click('.tray-head .dr-chest');
  await until(pop, () => document.querySelector('.dr-card.at-tray.crate.theme-winter.state-ready .dr-tab.on[data-id="event-demo"]'), 'its tab, open');
  await pop.click('.dr-claim');
  await until(pop, () => document.querySelector('.dr-reveal')?.dataset.phase === 'celebrate', 'the prize', 15000);
  assert.match(await pop.textContent('.dr-winner-caption'), /Snow Buddy\s*Epic emote/);
  assert.ok(await pop.evaluate(() => document.querySelector('.dr-done').getBoundingClientRect().bottom <= innerHeight), 'Done fits the popover');
  // Back ends the reveal first.
  await pop.click('[data-action="reward-back"]');
  await until(pop, () => document.querySelector('.dr-card.at-tray.crate.state-claimed') && !document.querySelector('.dr-card.revealing'), 'its page, claimed');
  assert.ok(await pop.evaluate(() => document.querySelector('.dr-actions').getBoundingClientRect().bottom <= innerHeight), 'the page fits the popover');
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
