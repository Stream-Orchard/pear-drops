const test = require('node:test');
const assert = require('node:assert/strict');
const { createDemo } = require('../../../src/main/demo');
const { History } = require('../../../src/main/history');
const { Db } = require('../../../src/main/db');

test('the stand-in server credits only campaigns the watched channel counts for', async () => {
  const { api } = createDemo();
  const before = { ...api.units };
  api.creditWatch('nightowl');
  assert.equal(api.units['c-cozy'], before['c-cozy'] + 2);
  assert.equal(api.units['c-neon'], before['c-neon']);
  api.creditWatch('pixelpear');
  assert.equal(api.units['c-neon'], before['c-neon'] + 2);
  assert.equal(api.units['c-cozy'], before['c-cozy'] + 2);
});

test('a conflict stops credit, and offline channels leave the live list', async () => {
  const { api } = createDemo();
  api.conflict = true;
  const before = api.units['c-neon'];
  api.creditWatch('pixelpear');
  assert.equal(api.units['c-neon'], before);
  api.offline.add('pixelpear');
  assert.ok(!(await api.livestreams(801)).some((s) => s.channel.slug === 'pixelpear'));
  assert.equal((await api.channelInfo('pixelpear')).livestream, null);
});

test('progress and claims follow the stand-in state', async () => {
  const { api } = createDemo();
  const neon = (await api.progress()).find((p) => p.id === 'c-neon');
  assert.equal(neon.progress_units, api.units['c-neon']);
  await api.claim('c-neon', 'r-neon-2');
  const again = (await api.progress()).find((p) => p.id === 'c-neon');
  assert.ok(again.rewards.find((r) => r.id === 'r-neon-2').claimed);
});

test('demo history ends at the stand-in progress and never goes backwards', () => {
  const demo = createDemo();
  const history = new History(new Db(':memory:')).load();
  demo.seedHistoryLog(history);
  const neon = history.all().filter((e) => e.type === 'credit' && e.campaignId === 'c-neon').map((e) => e.units);
  assert.ok(neon.length > 50);
  assert.equal(neon[neon.length - 1], demo.api.units['c-neon']);
  for (let i = 1; i < neon.length; i++) assert.ok(neon[i] > neon[i - 1]);
  const v = history.view({});
  assert.ok(v.sessions.length >= 10);
  assert.ok(v.totals.conflicts >= 1 && v.totals.stalls >= 1 && v.totals.claims >= 1);
});

test('the demo archive has a finished, a missed and a taken-down drop, already gone from Kick', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { DropArchive } = require('../../../src/main/archive');
  const archive = new DropArchive(fs.mkdtempSync(path.join(os.tmpdir(), 'pd-demo-arch-')), new Db(':memory:'), {});
  const demo = createDemo();
  demo.seedArchive(archive);
  const ids = archive.entries().map((e) => e.raw.id).sort();
  assert.deepEqual(ids, ['c-frost', 'c-melt', 'c-retro']);
  for (const e of archive.entries()) assert.ok(e.goneAt, `${e.raw.id} is no longer listed`);
  assert.ok(archive.get('c-melt').goneAt < new Date(archive.get('c-melt').raw.ends_at).getTime(), 'taken down early');
  assert.deepEqual(Object.keys(archive.get('c-frost').claimedAt).sort(), ['r-frost-1', 'r-frost-2']);
  demo.seedArchive(archive); // only fills an empty archive
  assert.equal(archive.entries().length, 3);
});

test('the stand-in Kick can stop listing a drop and list it again with a new end date', async () => {
  const { api } = createDemo();
  api.endCampaign('c-cozy');
  assert.ok(!(await api.campaigns()).some((c) => c.id === 'c-cozy'));
  api.endCampaign('nope');
  api.relistCampaign('nope', 1);
  api.relistCampaign('c-cozy', 2);
  const back = (await api.campaigns()).find((c) => c.id === 'c-cozy');
  assert.ok(new Date(back.ends_at).getTime() > Date.now() + 86_400_000);
});

test('the stand-in Kick follows and unfollows channels for a signed-in account', async () => {
  const { api } = createDemo();
  api.loggedIn = true;
  await api.follow('tidepool');
  assert.ok((await api.followedSlugs()).has('tidepool'));
  await api.unfollow('arcadia');
  assert.ok(!(await api.followedSlugs()).has('arcadia'));
  api.loggedIn = false;
  await assert.rejects(api.follow('kitekat'), (err) => err.status === 401);
});

test("the stand-in stream page: the player sends watch events, and tests can freeze it, end it or send Kick's realtime events", () => {
  const { streamPage, CHANNELS } = require('../../../src/main/demo');
  const slug = CHANNELS[0][0] ?? CHANNELS[0].slug;
  const player = streamPage(slug, 120, 'player');
  assert.match(player, /class="m-player"|m-player/);
  assert.match(player, /window\.__demoWatchEvent=fire/);
  assert.match(player, /setInterval\(fire,120000\)/);
  for (const hook of ['__demoFreeze', '__demoEnd', '__demoRealtime']) assert.ok(player.includes(`window.${hook}=`), hook);
  assert.match(player, /is offline/, 'an ended stream shows as offline');
  const chat = streamPage(slug, 120, 'chat');
  assert.ok(chat.includes("if(\"chat\"!=='chat')"), 'the chat sends no watch events');
});

test('the stand-in daily reward: the hour fills from watching, a claim picks a card, a duplicate gives level progress', async () => {
  const { api } = createDemo();
  await assert.rejects(api.dailyChallenges(), { status: 401 }, 'signed out');
  api.loggedIn = true;
  const [daily] = (await api.dailyChallenges()).data;
  assert.equal(daily.status, 'in_progress');
  assert.equal(daily.condition.progress, 37);
  assert.equal(daily.animations, null, 'no Kick videos: demo mode never goes to the network');
  assert.equal((await api.dailyChallenges({ recurrence: 'one_off' })).data[0].condition.type, 'onboarding_completed');
  const cards = (await api.collectibles()).data;
  assert.equal(cards.length, 72);
  assert.ok(cards.every((c) => c.card_url.startsWith('data:image/svg+xml')));
  await assert.rejects(api.claimDaily(daily.id), { status: 400 }, 'not ready yet');
  for (let i = 0; i < 12; i++) api.creditWatch('pixelpear');
  assert.equal((await api.dailyChallenges()).data[0].status, 'claimable');
  api.nextWinner = cards.find((c) => c.owned).id;
  const { data: won } = await api.claimDaily(daily.id);
  assert.equal(won.roulette.length, 24);
  assert.equal(won.consolation.watch_time_minutes, 12);
  assert.equal((await api.streak()).data.length_days, 13);
  assert.equal((await api.level()).data.progress_xp, 352);
  assert.equal((await api.dailyChallenges()).data[0].status, 'claimed');
  api.welcome.status = 'claimable';
  api.nextWinner = cards.find((c) => !c.owned).id;
  assert.equal((await api.claimDaily('welcome-demo')).data.consolation, null, 'a new card');
  assert.equal((await api.streak()).data.length_days, 13, 'only the daily one keeps the streak');
});

test('the stand-in event crate: listed like Kick’s Trick or Treat, filled by watching, and opened at once onto a square prize', async () => {
  const { api } = createDemo();
  api.loggedIn = true;
  assert.equal((await api.dailyChallenges()).data.length, 1, 'only when a test or a capture adds it');
  api.event = { id: 'event-demo', name: 'Harvest Moon', minutes: 174, status: 'in_progress' };
  const [, e] = (await api.dailyChallenges()).data;
  assert.deepEqual([e.name, e.recurrence, e.featured, e.condition.threshold, e.animations], ['Harvest Moon', 'daily', true, 180, null]);
  assert.ok(Date.parse(e.active_period.ends_at) > Date.parse(e.window.ends_at), 'a new one every day of its week');
  await assert.rejects(api.claimDaily('event-demo'), { status: 400 }, 'not ready yet');
  for (let i = 0; i < 3; i++) api.creditWatch('pixelpear');
  assert.equal((await api.dailyChallenges()).data[1].status, 'claimable');
  api.event.nextWinner = 'prize-4';
  const { data: won } = await api.claimDaily('event-demo');
  assert.deepEqual([won.reveal_type, won.roulette.length, won.winner.rarity, won.winner.card_url], ['instant', 0, 'mythic', '']);
  assert.ok(won.winner.thumbnail_url.startsWith('data:image/svg+xml'));
  const [, after] = (await api.dailyChallenges()).data;
  assert.deepEqual([after.status, after.winner.id], ['claimed', 'prize-4']);
  // Picked by its odds when no test chose.
  api.event = { id: 'event-demo', name: 'Harvest Moon', minutes: 180, status: 'claimable' };
  assert.ok((await api.claimDaily('event-demo')).data.winner.id.startsWith('prize-'));
});

test('the stand-in rewards list names each event prize won, by event and day; a winter event has its own; watch time on request', async () => {
  const { api } = createDemo();
  await assert.rejects(api.rewards(), { status: 401 });
  api.loggedIn = true;
  assert.deepEqual((await api.rewards()).data.rewards, []);
  api.event = { id: 'event-demo', name: 'Trick or Treat', minutes: 180, status: 'claimable', nextWinner: 'prize-2' };
  await api.claimDaily('event-demo');
  api.pastPrizes(2);
  const list = (await api.rewards()).data.rewards;
  assert.deepEqual(list.map((r) => [r.reward_id, r.display_label, r.source, r.source_label]), [
    ['prize-2', 'Hoot Hoot', 'gamification_reward_chest', 'Trick or Treat'],
    ['prize-3', 'Full Moon', 'gamification_reward_chest', 'Trick or Treat'],
    ['prize-1', 'Falling Leaf', 'gamification_reward_chest', 'Trick or Treat'],
  ]);
  const at = (r) => parseInt(r.id.replace(/-/g, '').slice(0, 12), 16);
  assert.ok(at(list[0]) - at(list[1]) > 80_000_000, 'a day apart, by their ids (UUIDv7, as Kick’s)');
  assert.equal(list[0].id[14], '7');
  api.event = { id: 'event-demo', name: 'Winter Wonderland', minutes: 180, status: 'claimable' };
  assert.ok((await api.claimDaily('event-demo')).data.winner.id.startsWith('gift-'));
  api.event = { id: 'event-demo', name: 'Winter Wonderland', minutes: 180, status: 'claimable', nextWinner: 'xp' };
  const { data } = await api.claimDaily('event-demo');
  assert.deepEqual([data.winner.watch_time.watch_time_minutes, data.winner.watch_time.next_level_badge.metadata.level], [30, 43]);
  assert.equal((await api.rewards()).data.rewards.length, 4, 'watch time isn’t a reward in the list');
});
