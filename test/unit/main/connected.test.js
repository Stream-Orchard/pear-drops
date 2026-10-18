// Settings › Connected apps: Pear Drops and a stand-in Stream Multiview over real Grapevine
// sockets, in a folder of their own.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { memoryKeyStore } = require('@streamorchard/grapevine');
const { standInPeer } = require('@streamorchard/grapevine/stand-in-peer');
const { Connected, farmingState, APP_ID } = require('../../../src/main/connected');

const MV = 'com.glowingpear.streammultiview';

const until = async (fn, what, ms = 5000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
};

/** A Connected with a fake farmer and settings, linked through its own folder. */
function setup({ enabled = false, status = 'farming', signedIn = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-link-'));
  let settings = { connectedApps: { [MV]: { enabled } } };
  const store = { get: () => settings, set: (patch) => (settings = { ...settings, ...patch }) };
  const farmer = Object.assign(new EventEmitter(), {
    status: { code: status },
    current: { slug: 'pixelpear', username: 'PixelPear', categoryName: 'Neon Rush', campaignIds: ['c1'] },
    model: { campaigns: [{ id: 'c1', name: 'Neon Rush Launch Week', units: 48, targetUnits: 120, rewards: [{ required: 60 }, { required: 120 }] }] },
  });
  const auth = { status: signedIn ? 'signed-in' : 'signed-out', user: signedIn ? { username: 'pearfan' } : null };
  const history = { events: [], add: (type, data) => history.events.push({ type, ...data }) };
  const place = { env: { ...process.env, GRAPEVINE_DIR: dir } };
  const c = new Connected({ store, farmer, auth: () => auth, version: '0.1.5', history, keys: memoryKeyStore(), place, appDataDir: dir });
  c.link.timing = { ...c.link.timing, pollMs: 40, backoffMs: [20, 40, 80] };
  return { c, dir, store, farmer, auth, history, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('drops.farming says what Pear Drops is doing, in its own words', () => {
  assert.equal(farmingState('farming', true), 'farming');
  assert.equal(farmingState('paused', true), 'paused');
  assert.equal(farmingState('done', true), 'done');
  for (const code of ['waiting', 'starting', 'error', undefined]) assert.equal(farmingState(code, true), 'waiting');
  assert.equal(farmingState('farming', false), 'signed-out');

  const { c, farmer, auth, cleanup } = setup();
  assert.deepEqual(c.farming(), {
    state: 'farming',
    account: { platform: 'kick', user: 'pearfan' },
    channel: { platform: 'kick', slug: 'pixelpear', name: 'PixelPear' },
    drop: { campaign: 'Neon Rush Launch Week', category: 'Neon Rush', progress: { done: 48, total: 120, unit: 'minutes' } },
  });
  farmer.model.campaigns[0].targetUnits = 0;
  assert.equal(c.farming().drop.progress.total, 120, 'or the last reward, without a target');
  farmer.current.campaignIds = ['gone'];
  assert.equal(c.farming().drop, null, 'a drop it no longer knows');
  farmer.status.code = 'waiting';
  assert.deepEqual(c.farming(), { state: 'waiting', account: { platform: 'kick', user: 'pearfan' }, channel: null, drop: null });
  auth.status = 'signed-out';
  assert.equal(c.farming().state, 'signed-out');
  assert.equal(c.farming().account, null);
  cleanup();
});

test('changes are published at once, the same state only once, and at most every 2 seconds', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 10_000 });
  const { c, farmer, cleanup } = setup();
  const sent = [];
  c.link.publish = (name, data) => sent.push([name, data.state, data.drop?.progress.done]);
  c.update();
  assert.deepEqual(sent, [['drops.farming.changed', 'farming', 48]]);
  c.update();
  assert.equal(sent.length, 1, 'nothing changed');
  farmer.model.campaigns[0].units = 49;
  c.update();
  c.update();
  assert.equal(sent.length, 1, 'waits out the 2 seconds');
  farmer.model.campaigns[0].units = 50;
  t.mock.timers.tick(2000);
  assert.deepEqual(sent[1], ['drops.farming.changed', 'farming', 50], 'and then sends the latest');
  farmer.model.campaigns[0].units = 51;
  c.update(); // progress: waits again
  farmer.status.code = 'paused';
  c.update();
  assert.equal(sent[2][1], 'paused', 'a new state goes at once, without waiting');
  t.mock.timers.tick(2000);
  assert.equal(sent.length, 3, 'and replaces the progress that was waiting');
  await c.stop();
  cleanup();
});

test('switched on, it links with Stream Multiview, hears about its players, and records it in History', async () => {
  const { c, dir, store, history, cleanup } = setup();
  const changes = [];
  c.on('change', () => changes.push(1));
  await c.sync();
  assert.equal(c.state().running, false, 'nothing listens while every switch is off');
  assert.deepEqual(
    c.state().peers.map((p) => [p.name, p.status, p.installed]),
    [['Stream Multiview', 'off', false]],
  );
  const peer = await standInPeer({ as: MV, dir, version: '0.4.0', provides: { players: '1.0' }, uses: { 'drops.farming': '1.0' }, timing: { pollMs: 40 } });
  try {
    await c.setEnabled(MV, true);
    assert.equal(store.get().connectedApps[MV].enabled, true);
    assert.equal(c.state().running, true);
    c.update();
    const heard = new Promise((resolve) => peer.link.once('event', (_from, name, params) => resolve([name, params.state])));
    await until(() => c.state().peers[0].status === 'connected', 'connected');
    assert.deepEqual(await heard, ['drops.farming.changed', 'farming']);
    peer.link.publish('players.changed', { platforms: { kick: { signedIn: false, mode: 'auto', account: null, open: [{ platform: 'kick', slug: 'pixelpear' }] } } });
    await until(() => c.state().peers[0].kick, 'its players');
    const [p] = c.state().peers;
    assert.equal(p.version, '0.4.0');
    assert.equal(p.kick.mode, 'auto');
    assert.equal(p.icon, undefined, 'logos come separately');
    assert.match(c.icons()[MV], /^data:image\/png;base64,/);
    assert.equal(c.icons(), c.icons(), 'read once');
    assert.ok(history.events.some((e) => e.type === 'link-connected' && e.text === 'Connected to Stream Multiview'));
    assert.ok(changes.length > 0);

    // It quits: noticed at once, and its players are forgotten.
    await peer.stop();
    await until(() => c.state().peers[0].status === 'waiting', 'waiting again');
    assert.equal(c.state().peers[0].kick, null);
    assert.ok(history.events.some((e) => e.type === 'link-disconnected' && /^Disconnected from Stream Multiview: /.test(e.text)));
  } finally {
    await peer.stop().catch(() => {});
    await c.stop();
    cleanup();
  }
});

test('Disconnect forgets the pairing on both sides and switches it off; the last switch off stops listening', async () => {
  const { c, dir, store, history, cleanup } = setup({ enabled: true });
  const peer = await standInPeer({ as: MV, dir, provides: { players: '1.0' }, uses: { 'drops.farming': '1.0' }, timing: { pollMs: 40 } });
  try {
    await c.sync();
    await until(() => c.link.isConnected(MV), 'connected');
    assert.ok(c.link.keys.get(MV));
    await c.disconnect(MV);
    assert.equal(c.link.keys.get(MV), null);
    assert.equal(store.get().connectedApps[MV].enabled, false);
    assert.equal(c.state().running, false);
    assert.ok(history.events.some((e) => e.type === 'link-unpaired'));
    await until(() => peer.link.keys.get(APP_ID) === null, 'the stand-in to forget it too');
    await c.setEnabled('com.someone.else', true);
    assert.equal(store.get().connectedApps['com.someone.else'], undefined, 'only known apps');
    await c.setEnabled(APP_ID, true);
    assert.equal(store.get().connectedApps[APP_ID], undefined, 'not itself');
  } finally {
    await peer.stop();
    await c.stop();
    cleanup();
  }
});

test('the other app saying Disconnect, Pair again, and a link that cannot start', async () => {
  const { c, dir, history, cleanup } = setup({ enabled: true });
  const peer = await standInPeer({ as: MV, dir, provides: { players: '1.0' }, uses: { 'drops.farming': '1.0' }, timing: { pollMs: 40 } });
  try {
    await c.sync();
    await until(() => c.link.isConnected(MV), 'connected');
    await peer.link.disconnect(APP_ID);
    await until(() => history.events.some((e) => e.type === 'link-unpaired'), 'recorded');
    assert.equal(history.events.find((e) => e.type === 'link-unpaired').text, 'Stream Multiview disconnected: both apps forgot the pairing');
    c.pairAgain(MV);
    assert.equal(c.link.keys.get(MV), null);
  } finally {
    await peer.stop();
    await c.stop();
    cleanup();
  }
  const broken = setup({ enabled: true });
  broken.c.link.start = async () => {
    throw new Error('Another copy of Pear Drops is already using Grapevine');
  };
  await broken.c.sync();
  assert.equal(broken.c.state().error, 'Another copy of Pear Drops is already using Grapevine');
  assert.equal(broken.c.state().running, false);
  await broken.c.stop();
  broken.cleanup();
});

test('a switch saved under an id the app had before a rename still counts', () => {
  const { c, store, cleanup } = setup();
  assert.equal(c.enabled(MV), false);
  store.set({ connectedApps: { [MV]: { enabled: true } } });
  assert.equal(c.enabled(MV), true);
  assert.equal(c.nameOf('com.nobody'), 'com.nobody');
  cleanup();
});
