// With nothing playing, the progress chart shows why: what resuming would bring, a radar over the
// drops still to go, or the rewards collected. Each check with Kick pulses the hero and the chart.
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchApp, until } = require('./app');

// Every channel the stand-in Kick has live.
const CHANNELS = ['arcadia', 'emberfox', 'glitchgarden', 'kitekat', 'lofilane', 'mossbyte', 'nightowl', 'novaquinn', 'pixelpear', 'tidepool'];

let a;
test.before(async () => {
  a = await launchApp({ size: { width: 1512, height: 944 } });
  await a.farming();
});
test.after(async () => {
  assert.deepEqual(a.errors, []);
  await a.close();
});

const setPaused = (on) => a.app.evaluate((_e, on) => global.pdDebug.farmer.setPaused(on), on);
const allOffline = (on = true) =>
  a.demo(
    async (d, { all, on }) => {
      for (const slug of all) on ? d.api.offline.add(slug) : d.api.offline.delete(slug);
      d.farmer.streams.clear();
      while (d.farmer.ticking) await new Promise((r) => setTimeout(r, 50));
      await d.tick();
    },
    { all: CHANNELS, on },
  );
const fits = () => a.win.evaluate(() => document.querySelector('#content').scrollHeight - document.querySelector('#content').clientHeight);

test('paused with a channel live, the chart shows what resuming would bring, with times from resuming', async () => {
  await setPaused(true);
  await until(a.win, () => document.querySelector('#chart .progress-chart.resume'), 'the resume chart', 10000);
  assert.match(await a.win.textContent('#chart .progress-chart'), /IF YOU RESUME/);
  assert.match(await a.win.textContent('#chart .progress-chart'), /after resuming/);
  assert.doesNotMatch(await a.win.textContent('#chart .progress-chart'), /FORECAST/);
  assert.match(await a.win.textContent('#chart .card-sub'), /to go once you resume/);
  await setPaused(false);
  await a.farming();
  assert.ok(await a.win.locator('#chart .progress-chart:not(.resume)').count(), 'the forecast again once farming');
});

test('with nothing live, a radar over the drops still to go; each check pulses the hero and ripples the radar', async () => {
  await allOffline();
  await until(a.win, () => document.querySelector('#chart .idle-scene.is-scan'), 'the radar', 15000);
  assert.equal(await a.win.locator('#chart .progress-chart').count(), 0, 'no campaign is picked while nothing plays');
  assert.equal(await a.win.locator('#chart .tabs').count(), 0, 'nor its tabs');
  const [left, drops] = await a.app.evaluate(() => {
    const rows = global.pdDebug.farmer.model.categories.filter((c) => c.enabled && c.needsWatching && !c.complete);
    return [rows.length, rows.reduce((n, c) => n + c.campaigns.filter((x) => x.needsWatching).length, 0)];
  });
  assert.equal(await a.win.locator('#chart .is-blip').count(), Math.min(8, left), 'a blip for each queue row still to go');
  assert.match(await a.win.textContent('#chart .card-sub'), new RegExp(`Looking for a live stream for ${drops} drops`));
  // A channel row's blip is its channel's avatar, named after its drop.
  assert.ok(await a.win.locator('#chart .is-blip .is-name', { hasText: 'Cozy Hours' }).count(), 'Cozy Hours on the radar');
  assert.ok(await a.win.locator('#hero .hero-next-check .check-ring').count(), 'the countdown to the next check');
  assert.ok((await fits()) <= 2, 'the dashboard still fits without scrolling');

  // A check: the hero's orb pulses, the radar ripples, and the monitor marks it.
  const at = await a.app.evaluate(() => global.pdDebug.farmer.checkedAt);
  await a.win.click('#hero [data-action="refresh"]');
  await until(a.win, (at) => state?.farm?.checkedAt > at, 'the check', 10000, at);
  await until(a.win, () => document.querySelector('#hero .orb-ping') && document.querySelector('#hero .hero-sweep') && document.querySelector('#chart .is-ripple'), 'the pulse', 10000);
  await until(a.win, () => document.querySelector('#chart .hb-check') && document.querySelector('#chart .hb-ping'), 'the check on the monitor', 10000);
  assert.match(await a.win.textContent('#chart .legend'), /Check/);

  // A redraw with nothing new leaves the scene, and so its animation, alone.
  await a.win.evaluate(() => (document.querySelector('#chart .is-beam').__kept = true));
  await a.app.evaluate(() => global.pdDebug.farmer.changed());
  await new Promise((r) => setTimeout(r, 600));
  assert.ok(await a.win.evaluate(() => document.querySelector('#chart .is-beam').__kept), 'the beam is the same element');
});

test('paused with nothing live, the radar stands still', async () => {
  await setPaused(true);
  await until(a.win, () => document.querySelector('#chart .idle-scene.is-paused'), 'the paused scene', 10000);
  assert.equal(await a.win.locator('#chart .is-beam').count(), 0);
  assert.match(await a.win.textContent('#chart .card-sub'), /None of the remaining drops’ channels are live/);
  await setPaused(false);
  await until(a.win, () => document.querySelector('#chart .idle-scene.is-scan'), 'the radar again', 10000);
});

test('with every drop collected, the rewards in an arc', async () => {
  await a.demo(async (d) => {
    for (let i = 0; i < 3; i++) {
      for (const id of Object.keys(d.api.units)) d.api.units[id] = 10_000;
      while (d.farmer.ticking) await new Promise((r) => setTimeout(r, 50));
      await d.farmer.tick({ force: true });
    }
  });
  await until(a.win, () => document.querySelector('#chart .idle-scene.is-done'), 'the done scene', 15000);
  assert.ok((await a.win.locator('#chart .is-reward').count()) >= 4, 'the rewards collected');
  assert.match(await a.win.textContent('#chart .card-sub'), /Nothing left to farm/);
  assert.ok((await fits()) <= 2);
});
