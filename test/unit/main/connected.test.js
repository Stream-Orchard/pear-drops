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

let shown = 0;

/** A Connected with a fake farmer and settings, linked through its own folder. */
function setup({ enabled = false, status = 'farming', signedIn = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-link-'));
  let settings = { connectedApps: { [MV]: { enabled } } };
  const store = { get: () => settings, set: (patch) => (settings = { ...settings, ...patch }) };
  const farmer = Object.assign(new EventEmitter(), {
    status: { code: status },
    current: { slug: 'pixelpear', username: 'PixelPear', categoryName: 'Neon Rush', campaignIds: ['c1'] },
    model: { campaigns: [{ id: 'c1', name: 'Neon Rush Launch Week', units: 48, targetUnits: 120, rewards: [{ id: 'r1', name: 'Reward', required: 60 }, { id: 'r2', name: 'Reward', required: 120 }] }] },
  });
  const auth = { status: signedIn ? 'signed-in' : 'signed-out', user: signedIn ? { username: 'pearfan' } : null };
  const history = { events: [], add: (type, data) => history.events.push({ type, ...data }) };
  const place = { env: { ...process.env, GRAPEVINE_DIR: dir } };
  const c = new Connected({ store, farmer, auth: () => auth, version: '0.1.5', history, keys: memoryKeyStore(), place, appDataDir: dir, show: () => (shown += 1) });
  c.link.timing = { ...c.link.timing, pollMs: 40, backoffMs: [20, 40, 80] };
  c.store = store;
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
    stream: {},
    drop: { campaign: 'Neon Rush Launch Week', category: 'Neon Rush', progress: { done: 48, total: 120, unit: 'minutes' }, rewards: { claimed: 0, total: 2, items: [{ name: 'Reward', required: 60, state: 'locked', unlocksAt: null }, { name: 'Reward', required: 120, state: 'locked', unlocksAt: null }] }, next: null, doneAt: null },
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

test('enough for a widget: pictures as Kick gives them, the stream, every reward and when each unlocks', () => {
  const { c, farmer, cleanup } = setup();
  const now = Date.parse('2026-10-18T09:00:00Z');
  Object.assign(farmer.current, { avatar: 'https://files.kick.com/pixelpear.webp', title: 'Neon Rush ranked', viewers: 1240 });
  Object.assign(farmer.model.campaigns[0], {
    endsAt: '2026-10-21T18:00:00Z',
    rewards: [
      { id: 'r2', name: 'Hype Rocket Emote', required: 60, image: 'pd-img://archive/r2.png' },
      { id: 'r1', name: 'Pear Badge', required: 30, claimed: true },
      { id: 'r3', name: 'Neon Crown', required: 120, ready: false },
      { id: 'g1', name: 'Game Skin', required: 90, tracked: false },
    ],
    next: { id: 'r2', name: 'Hype Rocket Emote', required: 60, remaining: 12 },
  });
  farmer.rawCampaigns = [{ id: 'c1', category: { image_url: 'https://files.kick.com/neon-rush.webp' }, rewards: [{ id: 'r2', image_url: 'drops/reward/r2.png' }, { id: 'r1', image_url: 'http://insecure/r1.png' }] }];
  farmer.forecast = () => ({ c1: { rate: 1, nextMinutes: 12, doneMinutes: 72 } });
  const f = c.farming(now);
  assert.deepEqual(f.channel, { platform: 'kick', slug: 'pixelpear', name: 'PixelPear', avatar: 'https://files.kick.com/pixelpear.webp' });
  assert.deepEqual(f.stream, { title: 'Neon Rush ranked', viewers: 1240 });
  assert.equal(f.drop.image, 'https://files.kick.com/neon-rush.webp');
  assert.equal(f.drop.endsAt, '2026-10-21T18:00:00.000Z');
  assert.deepEqual(f.drop.rewards, {
    claimed: 1,
    total: 3,
    items: [
      { name: 'Pear Badge', required: 30, state: 'claimed' },
      { name: 'Hype Rocket Emote', image: 'https://ext.kick.com/drops/reward/r2.png', required: 60, state: 'locked', unlocksAt: '2026-10-18T09:12:00.000Z' },
      { name: 'Neon Crown', required: 120, state: 'locked', unlocksAt: '2026-10-18T10:12:00.000Z' },
    ],
  }, "in unlock order, game rewards Pear Drops doesn't farm left out, pictures only as https");
  assert.equal(f.drop.next.unlocksAt, '2026-10-18T09:12:00.000Z');
  assert.equal(f.drop.doneAt, '2026-10-18T10:12:00.000Z');
  farmer.model.campaigns[0].rewards[0].ready = true;
  assert.equal(c.farming(now).drop.rewards.items[1].state, 'ready');
  assert.equal(c.farming(now).drop.rewards.items[1].unlocksAt, undefined, 'only locked ones have an unlock time');
  farmer.forecast = () => ({ c1: { rate: 0.01 } });
  assert.equal(c.farming(now).drop.doneAt, null, 'no times while it is stalled');
  // Every bit of it fits drops.farming's schema.
  const { Schemas } = require(path.join(path.dirname(require.resolve('@streamorchard/grapevine/package.json')), 'src', 'schema.js'));
  const params = { ...c.farming(now), seq: 1, at: new Date(now).toISOString() };
  assert.deepEqual(Schemas.load().validate('drops.farming', 1, 'event', 'drops.farming.changed', params), []);
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
    await until(() => c.state().peers[0].heard['players.changed'], 'its players');
    const [p] = c.state().peers;
    assert.equal(p.version, '0.4.0');
    assert.equal(p.heard['players.changed'].platforms.kick.mode, 'auto');
    assert.deepEqual(p.shares, { out: ['drops.farming'], in: ['players'] }, 'what the two share');
    assert.equal(p.icon, undefined, 'logos come separately');
    assert.match(c.icons()[MV], /^data:image\/png;base64,/);
    assert.equal(c.icons(), c.icons(), 'read once');
    assert.ok(history.events.some((e) => e.type === 'link-connected' && e.text === 'Connected to Stream Multiview'));
    assert.ok(changes.length > 0);
    assert.deepEqual(await peer.link.request(APP_ID, 'drops.farming.show'), { shown: true }, 'a widget click');
    assert.equal(shown, 1, 'brought Pear Drops to the front');

    // It quits: noticed at once, and its players are forgotten.
    await peer.stop();
    await until(() => c.state().peers[0].status === 'waiting', 'waiting again');
    assert.deepEqual(c.state().peers[0].heard, {}, 'what it said is forgotten');
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

test('any app Grapevine knows gets its own card and switch, with what the two would share', async () => {
  const { KNOWN_APPS } = require('@streamorchard/grapevine');
  const mv = KNOWN_APPS.find((a) => a.id === MV);
  const overlay = { ...mv, id: 'com.example.overlay', slug: 'stream-overlay', name: 'Stream Overlay', dataFolder: 'Stream Overlay', provides: ['clips'], uses: ['drops.farming'] };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-link-'));
  let settings = { connectedApps: {} };
  const store = { get: () => settings, set: (patch) => (settings = { ...settings, ...patch }) };
  const c = new Connected({ store, farmer: { status: {}, model: { campaigns: [] } }, auth: () => ({ status: 'signed-out' }), version: '0.1.5', knownApps: [...KNOWN_APPS, overlay], place: { env: { GRAPEVINE_DIR: dir } }, appDataDir: dir });
  const card = c.state().peers.find((p) => p.id === 'com.example.overlay');
  assert.equal(card.name, 'Stream Overlay');
  assert.equal(card.status, 'off');
  assert.deepEqual(card.shares, { out: ['drops.farming'], in: [] }, 'it uses what Pear Drops provides; Pear Drops has no use for clips');
  assert.match(c.icons()['com.example.overlay'], /^data:image\/png/);
  await c.setEnabled('com.example.overlay', true);
  assert.equal(settings.connectedApps['com.example.overlay'].enabled, true, 'its own switch');
  assert.equal(c.nameOf('com.example.overlay'), 'Stream Overlay');
  await c.stop(); // before its folder goes
  fs.rmSync(dir, { recursive: true, force: true });
});

test('what Pear Drops speaks comes from package.json, where grapevine-check reads it at each release', () => {
  const { grapevine } = require('../../../package.json');
  assert.equal(grapevine.app, APP_ID);
  assert.equal(APP_ID, 'com.streamorchard.peardrops');
  const { c, cleanup } = setup();
  assert.deepEqual(c.link.mine, { provides: { 'drops.farming': ['1.0'] }, uses: { players: ['1.0'] } });
  cleanup();
});

test('Test on the card: off, not open, a round trip, and a link that cannot start', async () => {
  const { c, dir, cleanup } = setup();
  try {
    assert.deepEqual(await c.test(MV), { ok: false, reason: 'off', text: 'Switch on Connect with Stream Multiview first' });
    c.store.set({ connectedApps: { [MV]: { enabled: true } } });
    const missing = await c.test(MV);
    assert.equal(c.state().running, true, 'switched on but not started yet: it starts');
    assert.deepEqual(missing, { ok: false, reason: 'not-running', text: "Stream Multiview isn't open" });
    const peer = await standInPeer({ as: MV, dir, version: '0.4.0', provides: { players: '1.0' }, uses: { 'drops.farming': '1.0' }, timing: { pollMs: 40 } });
    try {
      const ok = await c.test(MV);
      assert.equal(ok.ok, true, JSON.stringify(ok));
      assert.match(ok.text, /^Stream Multiview 0\.4\.0 answered in \d+ ms$/);
    } finally {
      await peer.stop();
    }
  } finally {
    await c.stop();
    cleanup();
  }
  const broken = setup({ enabled: true });
  broken.c.link.start = async () => {
    throw new Error('Another copy of Pear Drops is already using Grapevine');
  };
  assert.deepEqual(await broken.c.test(MV), { ok: false, reason: 'not-started', text: 'Another copy of Pear Drops is already using Grapevine' });
  broken.cleanup();
});
