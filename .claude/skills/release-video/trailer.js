// The Pear Drops trailer: a walkthrough of every main feature against the stand-in
// Kick (made-up channels, drops, chat and history).
//   node .claude/skills/release-video/video.js .claude/skills/release-video/trailer.js
module.exports = {
  name: 'pear-drops-trailer',
  steps: 11,
  signedIn: false,
  poster: { kicker: 'Introducing', h: 'Pear *Drops*', p: 'Every emote &amp; badge drop on Kick, collected on autopilot.' },

  async run(t) {
    const { m, wait } = t;
    await wait(1600);
    await t.uncard();
    await wait(1400);

    // 1. Sign in
    await t.step('Sign in *once*', 'Your login stays on this computer, encrypted with your system keychain.');
    await t.ring('.welcome-cta', 10);
    await wait(900);
    await t.click('[data-action="login"]');
    await t.unring();
    await m.waitForFunction(() => document.querySelector('#hero .hero-title'), null, { timeout: 20000 });
    await wait(2200);

    // 2. Finds the right streams
    await t.step('Finds the *right* streams', 'Live channels in each drop’s category, with the ones you follow first.');
    await t.ring('#hero .hero-grid', 10);
    await wait(2000);
    await t.click('[data-action="side-tab"][data-id="streams"]');
    await t.ring('#side', 6);
    await wait(2600);
    await t.unring();
    await t.click('[data-action="side-tab"][data-id="queue"]');
    await wait(600);

    // 3. Watches like you would
    await t.step('Watches like *you* would', 'Kick’s own player and chat, muted at the window. Every watch event is tracked live.');
    await t.zoom('#player', 1.5);
    await wait(2200);
    await t.unzoom(900);
    await t.zoom('#chart .monitor', 1.7);
    await t.demo((d) => d.credit());
    await wait(2400);
    await t.unzoom();

    // 4. Forecast
    await t.step('Knows when you’ll *finish*', 'Credited minutes, a live forecast, and the moment each reward unlocks.');
    await t.zoom('#chart .chart-wrap', 1.6);
    await t.moveTo('#chart .chart-wrap .m-ring');
    await wait(2800);
    await t.unzoom();

    // 5. Claims
    await t.step('Claims the *moment* it unlocks', 'No clicking, no checking back. It just lands in your collection.');
    await t.ring('#hero .hero-rewards', 8);
    await wait(900);
    await t.demo((d, u) => d.advance('c-neon', u), 180);
    await wait(3200);
    await t.unring();

    // 6. Recovers on its own
    await t.step('Recovers on its *own*', 'Offline streams, stalls, crashes or sleep: it reloads or switches, and keeps going.');
    await t.click('[data-action="side-tab"][data-id="activity"]');
    await t.ring('#hero .hero-stream', 8);
    await wait(900);
    await t.demo((d) => d.offline('arcadia'));
    await wait(2400);
    await t.ring('#side', 6);
    await wait(2400);
    await t.unring();

    // 7. Conflict alarm
    await t.step('Hears when credit goes *elsewhere*', 'Kick credits one stream per account. If another stream takes it, you’ll know right away.');
    await t.demo((d) => d.conflict(true));
    // Watch events keep coming but none are credited, until the alarm goes off.
    for (let i = 0; i < 6 && !(await m.evaluate(() => !!document.querySelector('#banner .banner'))); i++) {
      await t.demo((d) => d.credit());
      await wait(500);
    }
    await m.waitForFunction(() => document.querySelector('#banner .banner'), null, { timeout: 10000 });
    await t.ring('#banner', 6);
    await wait(3600);
    await t.unring();
    await t.demo((d) => d.conflict(false));
    await t.demo((d) => d.credit());
    await wait(800);

    // 8. Queue order
    await t.step('Your queue, your *order*', 'Drag to reorder. When a category is done, it moves straight on to the next.');
    await t.click('[data-action="side-tab"][data-id="queue"]');
    await t.ring('#side', 6);
    await wait(700);
    await t.drag('.cat[data-cat-id] >> nth=1', '.cat[data-cat-id] >> nth=0');
    await wait(2600);
    await t.unring();

    // 9. Done and missed
    await t.step('Nothing is *lost*', 'Finished and missed drops move to Done, saved with their artwork after Kick takes them down.');
    await t.click('[data-action="side-tab"][data-id="done"]');
    await t.ring('#side', 6);
    await wait(1600);
    await t.moveTo('.past.missed .mini-reward.missed >> nth=0');
    await wait(2200);
    await t.moveTo('.past.completed .mini-reward >> nth=0');
    await wait(1800);
    await t.unring();
    await t.click('[data-action="side-tab"][data-id="queue"]');

    // 10. History
    await t.step('Every minute, on *record*', 'A full history: daily activity, efficiency, stalls and recoveries, per drop and overall.');
    await t.click('[data-action="view"][data-id="history"]');
    await wait(2200);
    await t.ring('.hist-kpis', 8);
    await wait(1800);
    await t.click('.drop-item >> nth=0');
    await t.ring('.hist-chart-card', 6);
    await wait(2400);
    await t.click('[data-action="hist-table"][data-id="sessions"]');
    await t.ring('.hist-table-card', 6);
    await wait(2400);
    await t.unring();
    await t.click('[data-action="view"][data-id="dashboard"]');
    await wait(900);

    // 11. Menu bar
    await t.step('Lives in your *menu bar*', 'Close the window and it keeps farming. Progress at a glance, any time.', { kicker: 'And finally' });
    await t.trayPopover(true);
    await wait(3600);
    await t.trayPopover(false);

    // Outro
    await t.uncap();
    await t.card({ noDots: true, kicker: 'Pear Drops', h: 'Set it. *Forget it.* Collect them all.', items: ['Auto-claim', 'Smart stream picking', 'Stall recovery', 'Conflict alarm', 'Live forecast', 'Full history', 'Drop archive', 'Menu bar mode', 'Encrypted login'] });
    await wait(5200);
  },
};
