const test = require('node:test');
const assert = require('node:assert/strict');
const { createDemo } = require('../../../src/main/demo');
const { History } = require('../../../src/main/history');

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
  const history = new History('/nonexistent-dir-for-tests');
  history.rewrite = () => {};
  demo.seedHistoryLog(history);
  const neon = history.events.filter((e) => e.type === 'credit' && e.campaignId === 'c-neon').map((e) => e.units);
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
  const archive = new DropArchive(fs.mkdtempSync(path.join(os.tmpdir(), 'kdf-demo-arch-')), {});
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
