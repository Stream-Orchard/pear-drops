const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Farmer, rewardKind } = require('../../../src/main/farmer');
const { History } = require('../../../src/main/history');
const { DropArchive } = require('../../../src/main/archive');

const MIN = 60_000;

// ---- fakes ---------------------------------------------------------------

function campaign(id, { category = { id: 1, name: 'Neon Rush' }, channels = [], rewards, org = 'KICK', connect = '', endsIn = 3 } = {}) {
  return {
    id,
    name: `Campaign ${id}`,
    status: 'active',
    starts_at: new Date(Date.now() - 86_400_000).toISOString(),
    ends_at: new Date(Date.now() + endsIn * 86_400_000).toISOString(),
    category,
    organization: { name: org },
    connect_url: connect,
    channels: channels.map((c) => ({ id: c.id, slug: c.slug, user: { username: c.slug } })),
    rewards: rewards ?? [{ id: `${id}-r1`, name: 'Hype Emote', required_units: 60, image_url: 'drops/x.png' }],
  };
}

function live(slug, id, viewers = 100) {
  return { title: `${slug} live`, viewer_count: viewers, thumbnail: { src: 'https://x/t.webp' }, start_time: new Date().toISOString(), channel: { id, slug, username: slug, profile_pic: null }, language: 'en', is_mature: false };
}

class FakeApi {
  constructor({ campaigns, streams = {}, units = {}, followed = [] }) {
    this.list = campaigns;
    this.streams = streams; // categoryId -> [livestream]
    this.units = units;
    this.claimed = new Set();
    this.followed = new Set(followed);
    this.offline = new Set();
    this.ineligible = new Set();
    this.calls = [];
    this.progressError = null;
  }
  async campaigns() {
    return this.list;
  }
  async followedSlugs() {
    return this.followed;
  }
  async progress() {
    if (this.progressError) throw this.progressError;
    return this.list
      .filter((c) => this.units[c.id] !== undefined)
      .map((c) => ({ id: c.id, name: c.name, progress_units: this.units[c.id], rewards: c.rewards.map((r) => ({ id: r.id, claimed: this.claimed.has(r.id), progress: Math.min(1, this.units[c.id] / r.required_units) })) }));
  }
  async livestreams(categoryId) {
    return (this.streams[categoryId] ?? []).filter((s) => !this.offline.has(s.channel.slug));
  }
  async channelInfo(slug) {
    const cat = Object.entries(this.streams).find(([, list]) => list.some((s) => s.channel.slug === slug));
    if (!cat || this.offline.has(slug)) return { livestream: null };
    return { livestream: { is_live: true, categories: [{ id: Number(cat[0]) }] } };
  }
  async campaignsForLivestream(channelId, categoryId) {
    if (this.ineligible.has(channelId)) return [];
    return this.list.filter((c) => c.category.id === categoryId && (!c.channels.length || c.channels.some((x) => x.id === channelId)));
  }
  async claim(campaignId, rewardId) {
    this.calls.push(['claim', campaignId, rewardId]);
    this.claimed.add(rewardId);
  }
}

class FakeWatcher extends EventEmitter {
  constructor() {
    super();
    this.watching = null;
    this.reloads = 0;
    this.status = { loadedAt: null, lastAdvanceAt: null };
  }
  watch(slug) {
    this.watching = slug;
    this.status = { slug, loadedAt: Date.now(), lastAdvanceAt: Date.now() };
  }
  reload() {
    this.reloads += 1;
    this.status.loadedAt = Date.now();
    this.status.lastAdvanceAt = Date.now();
  }
  stop() {
    this.watching = null;
    this.status = { loadedAt: null, lastAdvanceAt: null };
  }
}

function store(overrides = {}) {
  let data = { stallMinutes: 20, refreshSeconds: 60, autoClaim: true, includeGameDrops: false, alertOnStall: true, categoryOrder: [], disabledCategories: [], ...overrides };
  return { get: () => data, set: (p) => (data = { ...data, ...p }) };
}

function setup(apiOptions, storeOptions, extra = {}) {
  const api = new FakeApi(apiOptions);
  const watcher = new FakeWatcher();
  const history = new History('/nonexistent-dir-for-tests');
  history.writing = Promise.resolve();
  const farmer = new Farmer({ api, watcher, store: store(storeOptions), history, ...extra });
  farmer.running = true;
  farmer.schedule = () => {};
  return { api, watcher, farmer, history };
}

// ---- tests ---------------------------------------------------------------

test('rewardKind: emotes and badges are tracked, linked-account rewards are game drops', () => {
  assert.equal(rewardKind({}, { name: 'Llama Emote' }), 'emote');
  assert.equal(rewardKind({}, { name: 'Forgemaster Badge' }), 'badge');
  assert.equal(rewardKind({ organization: { name: 'KICK' }, connect_url: '' }, { name: 'x1 entry' }), 'kick');
  assert.equal(rewardKind({ organization: { name: 'Riot Games' }, connect_url: 'https://riot' }, { name: '"Stamp" Spray' }), 'game');
});

test('picks a followed stream first and records the watch session', async () => {
  const { farmer, watcher, history } = setup({
    campaigns: [campaign('a')],
    streams: { 1: [live('big', 1, 9000), live('friend', 2, 50)] },
    followed: ['friend'],
  });
  await farmer.tick();
  assert.equal(watcher.watching, 'friend');
  assert.equal(farmer.status.code, 'farming');
  const start = history.events.find((e) => e.type === 'watch-start');
  assert.equal(start.slug, 'friend');
  assert.deepEqual(start.campaignIds, ['a']);
});

test('game-only campaigns are ignored unless game drops are included', async () => {
  const game = campaign('g', { org: 'Riot Games', connect: 'https://riot', rewards: [{ id: 'g1', name: 'Skin', required_units: 30 }] });
  const { farmer, watcher } = setup({ campaigns: [game], streams: { 1: [live('s', 1)] } });
  await farmer.tick();
  assert.equal(watcher.watching, null);
  assert.equal(farmer.status.code, 'done');

  const withGames = setup({ campaigns: [game], streams: { 1: [live('s', 1)] } }, { includeGameDrops: true });
  await withGames.farmer.tick();
  assert.equal(withGames.watcher.watching, 's');
});

test('channel-restricted campaigns only watch their channels, and skip ineligible ones', async () => {
  const restricted = campaign('r', { channels: [{ id: 2, slug: 'two' }, { id: 3, slug: 'three' }] });
  const { farmer, watcher, api, history } = setup({ campaigns: [restricted], streams: { 1: [live('one', 1, 999), live('two', 2, 50), live('three', 3, 10)] } });
  api.ineligible.add(2);
  await farmer.tick();
  assert.equal(watcher.watching, 'three');
  assert.ok(history.events.some((e) => e.type === 'not-eligible' && e.slug === 'two'));
});

test('credits are recorded with running totals and reset the stall clock', async () => {
  const { farmer, api, history } = setup({ campaigns: [campaign('a')], streams: { 1: [live('s', 1)] }, units: { a: 10 } });
  await farmer.tick();
  farmer.current.lastProgressAt = Date.now() - 10 * MIN;
  api.units.a = 12;
  await farmer.tick();
  const credit = history.events.find((e) => e.type === 'credit');
  assert.equal(credit.delta, 2);
  assert.equal(credit.units, 12);
  assert.equal(credit.slug, 's');
  assert.ok(Date.now() - farmer.current.lastProgressAt < 1000);
  assert.equal(farmer.stats.earned, 2);
});

test('a stall reloads first, then switches to another stream', async () => {
  const { farmer, watcher, history } = setup({ campaigns: [campaign('a')], streams: { 1: [live('first', 1, 500), live('second', 2, 100)] } });
  await farmer.tick();
  assert.equal(watcher.watching, 'first');

  farmer.current.lastProgressAt = Date.now() - 21 * MIN;
  await farmer.tick();
  assert.equal(watcher.reloads, 1);
  assert.equal(watcher.watching, 'first');

  farmer.current.lastProgressAt = Date.now() - 21 * MIN;
  await farmer.tick();
  assert.equal(watcher.watching, 'second');
  const types = history.events.map((e) => e.type);
  assert.equal(types.filter((t) => t === 'stall').length, 2);
  assert.ok(types.includes('reload'));
  const end = history.events.find((e) => e.type === 'watch-end');
  assert.match(end.reason, /No progress/);
});

test('an offline stream is left for the next one', async () => {
  const { farmer, watcher, api, history } = setup({ campaigns: [campaign('a')], streams: { 1: [live('first', 1, 500), live('second', 2, 100)] } });
  await farmer.tick();
  api.offline.add('first');
  farmer.streams.clear();
  await farmer.tick();
  assert.equal(watcher.watching, 'second');
  assert.ok(history.events.some((e) => e.type === 'offline' && e.slug === 'first'));
});

test('three uncredited watch events raise a conflict alert once', async () => {
  const { farmer, watcher, history } = setup({ campaigns: [campaign('a')], streams: { 1: [live('s', 1)] } });
  await farmer.tick();
  const alerts = [];
  farmer.on('stall-alert', (a) => alerts.push(a));
  for (let i = 0; i < 4; i++) watcher.emit('watch-event', { t: Date.now() });
  assert.equal(alerts.length, 1);
  assert.equal(history.events.filter((e) => e.type === 'conflict').length, 1);
});

test('ready rewards are claimed, and a finished category moves on to the next', async () => {
  const first = campaign('a', { category: { id: 1, name: 'First' }, endsIn: 1 });
  const second = campaign('b', { category: { id: 2, name: 'Second' }, endsIn: 5 });
  const { farmer, api, watcher, history } = setup({ campaigns: [first, second], streams: { 1: [live('one', 1)], 2: [live('two', 2)] }, units: { a: 50 } });
  await farmer.tick();
  assert.equal(watcher.watching, 'one');

  api.units.a = 60;
  await farmer.tick();
  assert.deepEqual(api.calls[0], ['claim', 'a', 'a-r1']);
  assert.equal(watcher.watching, 'two');
  const types = history.events.map((e) => e.type);
  for (const t of ['unlock', 'claim', 'campaign-complete', 'category-complete']) assert.ok(types.includes(t), t);
});

test('the user order of categories wins over end dates', async () => {
  const first = campaign('a', { category: { id: 1, name: 'First' }, endsIn: 1 });
  const second = campaign('b', { category: { id: 2, name: 'Second' }, endsIn: 5 });
  const { farmer, watcher } = setup({ campaigns: [first, second], streams: { 1: [live('one', 1)], 2: [live('two', 2)] } }, { categoryOrder: [2, 1] });
  await farmer.tick();
  assert.equal(watcher.watching, 'two');
});

test('a 401 from Kick signs out instead of retrying forever', async () => {
  const { farmer, api } = setup({ campaigns: [campaign('a')] });
  const err = new Error('HTTP 401');
  err.status = 401;
  api.progressError = err;
  let lost = false;
  farmer.on('auth-lost', () => (lost = true));
  await farmer.tick();
  assert.ok(lost);
});

test('a failed refresh retries soon, backing off up to the normal refresh, and resets once Kick answers', async () => {
  const { farmer, api } = setup({ campaigns: [campaign('a')], streams: { 1: [live('s', 1)] } }, { refreshSeconds: 30 });
  const waits = [];
  farmer.schedule = (ms) => waits.push(ms);
  api.progressError = new Error('offline');
  for (let i = 0; i < 4; i++) await farmer.tick();
  assert.deepEqual(waits, [5_000, 10_000, 20_000, 30_000], 'never longer than the 30s refresh');
  assert.match(farmer.status.message, /retrying in 30s/);
  api.progressError = null;
  await farmer.tick();
  assert.equal(waits.at(-1), 30_000, 'back to the normal refresh');
  api.progressError = new Error('offline again');
  await farmer.tick();
  assert.equal(waits.at(-1), 5_000, 'the backoff starts over');
});

test('trayInfo shows the current drop as a fraction and percentage', async () => {
  const { farmer } = setup({ campaigns: [campaign('a')], streams: { 1: [live('s', 1)] }, units: { a: 30 } });
  await farmer.tick();
  const info = farmer.trayInfo();
  assert.equal(info.tone, 'farming');
  assert.equal(info.title, '50%');
  assert.equal(info.fraction, 0.5);
});

test('finished categories always sort last, whatever the saved order', async () => {
  const done = campaign('d', { category: { id: 9, name: 'Done' } });
  const open = campaign('o', { category: { id: 1, name: 'Open' } });
  const { farmer, api } = setup({ campaigns: [done, open], streams: { 1: [live('s', 1)] }, units: { d: 60 } }, { categoryOrder: [9, 1] });
  api.claimed.add('d-r1');
  await farmer.tick();
  assert.deepEqual(farmer.model.categories.map((c) => c.id), [1, 9]);
  assert.ok(farmer.model.categories[1].complete);
});

test('a drop about to expire jumps the queue, but only if its next reward can still be earned', async () => {
  const hours = (h) => new Date(Date.now() + h * 3600_000).toISOString();
  const later = campaign('l', { category: { id: 1, name: 'Later' }, endsIn: 5 });
  const soon = campaign('s', { category: { id: 2, name: 'Soon' } });
  soon.ends_at = hours(2); // 60 min needed, 120 min left: tight but doable
  const hopeless = campaign('h', { category: { id: 3, name: 'Hopeless' }, rewards: [{ id: 'h1', name: 'Big Badge', required_units: 600 }] });
  hopeless.ends_at = hours(1);
  const { farmer, watcher, history } = setup(
    { campaigns: [later, soon, hopeless], streams: { 1: [live('a', 1)], 2: [live('b', 2)], 3: [live('c', 3)] } },
    { categoryOrder: [1, 3, 2] },
  );
  await farmer.tick();
  assert.deepEqual(farmer.model.categories.map((c) => c.id), [2, 1, 3]);
  assert.equal(watcher.watching, 'b');
  assert.ok(history.events.some((e) => e.type === 'priority' && e.campaignId === 's'));

  const off = setup({ campaigns: [later, soon], streams: { 1: [live('a', 1)], 2: [live('b', 2)] } }, { categoryOrder: [1, 2], prioritizeExpiring: false });
  await off.farmer.tick();
  assert.equal(off.watcher.watching, 'a');
});

test('urgent drops are ordered by slack, and switching for one is recorded as a decision', async () => {
  const hours = (h) => new Date(Date.now() + h * 3600_000).toISOString();
  const roomy = campaign('r', { category: { id: 1, name: 'Roomy' }, endsIn: 5 });
  const tight = campaign('t', { category: { id: 2, name: 'Tight' }, rewards: [{ id: 't1', name: 'Tight Badge', required_units: 300 }] });
  tight.ends_at = hours(6); // needs 5h, 6h left: 1h to spare
  const early = campaign('e', { category: { id: 3, name: 'Early' }, rewards: [{ id: 'e1', name: 'Early Emote', required_units: 30 }] });
  early.ends_at = hours(1.2); // needs 30m, 72m left: 42m to spare
  const { farmer, watcher, api, history } = setup({ campaigns: [roomy], streams: { 1: [live('a', 1)], 2: [live('b', 2)], 3: [live('c', 3)] } });
  await farmer.tick();
  assert.equal(watcher.watching, 'a');
  const pick = history.events.find((e) => e.type === 'decision');
  assert.match(pick.text, /^Picked a for Roomy: top of your queue/);

  api.list = [roomy, tight, early];
  farmer.campaignsAt = 0;
  await farmer.tick();
  assert.deepEqual(farmer.model.categories.map((c) => c.id).slice(0, 2), [3, 2]);
  assert.equal(watcher.watching, 'c');
  const sw = history.events.filter((e) => e.type === 'decision').at(-2);
  assert.match(sw.text, /^Switching to Early: Campaign e ends in 1h 1[0-2]m with 30 min to go/);
});

test('a higher category that comes back online takes over, once its stream is confirmed eligible', async () => {
  const top = campaign('t', { category: { id: 1, name: 'Top' }, endsIn: 1 });
  const next = campaign('n', { category: { id: 2, name: 'Next' }, endsIn: 5 });
  const { farmer, watcher, api, history } = setup({ campaigns: [top, next], streams: { 1: [live('top', 1)], 2: [live('next', 2)] } });
  api.offline.add('top');
  await farmer.tick();
  assert.equal(watcher.watching, 'next', 'skips a category with nothing live');

  // Back online, but not eligible yet: stay put.
  api.offline.delete('top');
  api.ineligible.add(1);
  await farmer.tick();
  assert.equal(watcher.watching, 'next');
  assert.ok(history.events.some((e) => e.type === 'decision' && /^Stayed on next/.test(e.text)));

  // Eligible now (after the skip expires): switch up.
  api.ineligible.delete(1);
  farmer.blacklist.clear();
  farmer.streams.clear();
  await farmer.tick();
  assert.equal(watcher.watching, 'top');
  assert.ok(history.events.some((e) => e.type === 'decision' && /^Switching to Top/.test(e.text)));
});

test('smart order watches what expires first, re-sorts when it comes online, and ignores small differences', async () => {
  const hours = (h) => new Date(Date.now() + h * 3600_000).toISOString();
  const long = campaign('l', { category: { id: 1, name: 'Long' } });
  long.ends_at = hours(48);
  const short = campaign('s', { category: { id: 2, name: 'Short' } });
  short.ends_at = hours(8);
  const close = campaign('c', { category: { id: 3, name: 'Close' } });
  close.ends_at = hours(7.8); // only 12 min sooner than Short
  const { farmer, watcher, api, history } = setup({ campaigns: [long, short, close], streams: { 1: [live('l', 1)], 2: [live('s', 2)], 3: [live('c', 3)] } }, { queueMode: 'smart', categoryOrder: [1, 2, 3] });
  api.offline.add('s');
  api.offline.add('c');
  await farmer.tick();
  assert.equal(watcher.watching, 'l');

  api.offline.delete('s');
  farmer.streams.clear();
  await farmer.tick();
  assert.equal(watcher.watching, 's', 'the sooner-expiring drop takes over when it comes online');
  assert.ok(history.events.some((e) => e.type === 'decision' && /Switching to Short: Short ends sooner/.test(e.text)));

  api.offline.delete('c');
  farmer.streams.clear();
  await farmer.tick();
  assert.equal(farmer.model.categories[0].id, 3, 'Close sorts first…');
  assert.equal(watcher.watching, 's', '…but 12 minutes sooner is not worth a switch');
});

test('the startup cache shows the last known drops at once, and history rebuilds the chart', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pd-cache-')), 'cache.json');
  const first = setup({ campaigns: [campaign('a')], streams: { 1: [live('s', 1)] }, units: { a: 20 } });
  first.farmer.cacheFile = file;
  await first.farmer.tick();
  clearTimeout(first.farmer.cacheTimer);
  first.farmer.cacheTimer = null;
  first.farmer.saveCache();
  await new Promise((r) => setTimeout(r, 2200));

  const second = setup({ campaigns: [], streams: {} });
  second.farmer.cacheFile = file;
  second.history.events = [{ t: Date.now() - 600_000, type: 'credit', campaignId: 'a', delta: 2, units: 18 }];
  second.farmer.seedFromHistory();
  assert.ok(second.farmer.loadCache());
  assert.equal(second.farmer.model.campaigns[0].id, 'a');
  assert.equal(second.farmer.model.campaigns[0].units, 20);
  assert.equal(second.farmer.model.categories[0].streamCount, 1);
  assert.equal(second.farmer.status.code, 'starting');
  assert.deepEqual(second.farmer.samples[0].units, { a: 18 });
  assert.equal(second.farmer.prevUnits.size, 0, 'cached progress is not a credit baseline');
});

test('leaves a stream whose streamer changes category, or that stops counting for the drop', async () => {
  const c = campaign('a');
  const { farmer, watcher, api, history } = setup({ campaigns: [c], streams: { 1: [live('first', 1, 500), live('second', 2, 100), live('third', 3, 50)] } });
  await farmer.tick();
  assert.equal(watcher.watching, 'first');

  // The streamer moves to another category.
  api.streams[7] = [live('first', 1, 500)];
  api.streams[1] = api.streams[1].filter((s) => s.channel.slug !== 'first');
  await farmer.tick();
  assert.equal(watcher.watching, 'second');
  assert.ok(history.events.some((e) => e.type === 'decision' && /^Left first: streamer changed category/.test(e.text)));

  // Five minutes later Kick says this stream no longer counts.
  api.ineligible.add(2);
  farmer.current.eligibleCheckedAt = Date.now() - 6 * MIN;
  await farmer.tick();
  assert.equal(watcher.watching, 'third');
  assert.ok(history.events.some((e) => e.type === 'decision' && /^Left second: stream no longer counts/.test(e.text)));
});

test('a claim only counts once Kick confirms it; an unconfirmed one is retried', async () => {
  const { farmer, api, history } = setup({ campaigns: [campaign('a')], streams: { 1: [live('s', 1)] }, units: { a: 60 } });
  const real = api.claim.bind(api);
  api.claim = async (cid, rid) => api.calls.push(['claim', cid, rid]); // Kick answers OK but doesn't claim
  await farmer.tick();
  assert.equal(history.events.filter((e) => e.type === 'claim').length, 0);
  assert.match(history.events.find((e) => e.type === 'claim-failed').text, /not confirmed/);
  assert.ok(farmer.claimBackoff.get('a-r1') > Date.now());

  api.claim = real;
  farmer.claimBackoff.clear();
  await farmer.tick();
  const ok = history.events.find((e) => e.type === 'claim');
  assert.ok(ok?.confirmed);
  assert.match(ok.text, /confirmed by Kick/);
  assert.equal(farmer.stats.claims, 1);
});

test('an unconfirmed claim does not hold the stream: it moves on and keeps retrying the claim', async () => {
  const first = campaign('a', { category: { id: 1, name: 'First' }, endsIn: 1 });
  const second = campaign('b', { category: { id: 2, name: 'Second' }, endsIn: 5 });
  const { farmer, api, watcher } = setup({ campaigns: [first, second], streams: { 1: [live('one', 1)], 2: [live('two', 2)] }, units: { a: 50 } });
  await farmer.tick();
  assert.equal(watcher.watching, 'one');

  const real = api.claim.bind(api);
  api.claim = async (cid, rid) => api.calls.push(['claim', cid, rid]); // accepted, not confirmed
  api.units.a = 60;
  await farmer.tick();
  assert.equal(watcher.watching, 'two', 'moved on while the claim is pending');
  assert.equal(farmer.model.categories.find((c) => c.id === 1).needsWatching, false);

  api.claim = real;
  farmer.claimBackoff.clear();
  await farmer.tick();
  assert.ok(api.claimed.has('a-r1'), 'the claim was retried and went through');
  assert.equal(watcher.watching, 'two');
});

test('finished and missed drops are listed apart from the queue, and kept after Kick removes them', async () => {
  const dir = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'pd-farm-arch-'));
  const archive = new DropArchive(dir, { fetchImage: async () => ({ buffer: Buffer.from('GIF89a'), type: 'image/gif' }) });
  const done = campaign('done', { category: { id: 1, name: 'First', image_url: 'https://x/first.png' } });
  const gone = campaign('gone', { category: { id: 2, name: 'Second' }, rewards: [{ id: 'g1', name: 'A Emote', required_units: 30 }, { id: 'g2', name: 'B Badge', required_units: 90 }] });
  const game = campaign('game', { category: { id: 3, name: 'Game' }, org: 'Studio', connect: 'https://link', rewards: [{ id: 'k1', name: 'Skin', required_units: 30 }] });
  // Kick also lists drops that ended months ago; one you never took part in isn't "missed".
  const old = { ...campaign('old', { category: { id: 4, name: 'Old' }, endsIn: -60 }), status: 'expired' };
  const { farmer, api, history } = setup({ campaigns: [done, gone, game, old], streams: { 2: [live('two', 2)] }, units: { done: 60, gone: 40 } }, {}, { archive });
  api.claimed.add('done-r1');
  api.claimed.add('g1');
  await farmer.tick();
  assert.deepEqual(farmer.model.past.map((p) => [p.id, p.status]), [['done', 'completed']], 'finished, still on Kick');
  assert.equal(farmer.snapshot().past.length, 1);

  // Kick drops two campaigns from its list (they ended).
  api.list = [done];
  await farmer.tick({ force: true });
  const past = Object.fromEntries(farmer.model.past.map((p) => [p.id, p]));
  assert.equal(past.gone.status, 'missed');
  assert.equal(past.gone.claimed, 1);
  assert.equal(past.gone.total, 2);
  assert.equal(past.gone.units, 40, 'last known progress');
  assert.equal(past.gone.onKick, false);
  assert.equal(past.gone.removed, true, 'taken down before its end date');
  assert.equal(past.game, undefined, 'game-only drops are left out');
  assert.equal(past.old, undefined, 'a drop that ended before the app saw it');
  assert.equal(farmer.dropInfo('gone').status, 'missed');
  assert.equal(farmer.dropInfo('done').status, 'completed');
  assert.equal(farmer.dropInfo('nope'), null);
  const ended = history.events.find((e) => e.type === 'campaign-ended' && e.campaignId === 'gone');
  assert.match(ended.text, /taken down by Kick: missed 1 of 2 rewards/);
  assert.equal(history.events.filter((e) => e.type === 'campaign-ended').length, 1, 'game drops are not recorded');

  // Images switch to the stored copies once downloaded.
  await archive.pump();
  farmer.buildModel();
  assert.match(farmer.model.past.find((p) => p.id === 'done').image, /^pd-img:\/\/drop\//);

  // Relisted with a new end date: back in the queue, out of the past list.
  api.list = [done, campaign('gone', { category: { id: 2, name: 'Second' }, endsIn: 4, rewards: gone.rewards })];
  await farmer.tick({ force: true });
  assert.ok(farmer.model.campaigns.some((c) => c.id === 'gone'));
  assert.ok(!farmer.model.past.some((p) => p.id === 'gone'));
  assert.ok(history.events.some((e) => e.type === 'campaign-back' && e.campaignId === 'gone'));
});

test('following a channel on Kick puts its streams first, and is recorded', async () => {
  const cat = { id: 1, name: 'Neon Rush' };
  const { farmer, api, watcher, history } = setup({ campaigns: [campaign('a', { category: cat })], streams: { 1: [live('big', 1, 900), live('small', 2, 10)] }, units: { a: 0 } });
  api.follow = async (slug) => api.followed.add(slug);
  api.unfollow = async (slug) => api.followed.delete(slug);
  await farmer.tick();
  assert.equal(watcher.watching, 'big');
  await farmer.setFollow('Small', true);
  assert.ok(farmer.followed.has('small'));
  assert.equal(farmer.model.categories[0].streams[0].slug, 'small', 'followed channels sort first');
  await farmer.setFollow('big', false);
  assert.equal(farmer.current.followed, false);
  assert.deepEqual(history.events.filter((e) => /follow/.test(e.type)).map((e) => [e.type, e.slug]), [['follow', 'small'], ['unfollow', 'big']]);
  api.follow = async () => {
    throw Object.assign(new Error('nope'), { status: 403 });
  };
  await assert.rejects(farmer.setFollow('big', true));
  assert.ok(!farmer.followed.has('big'), 'nothing changes when Kick refuses');
});

test('a drop rebuilt from history shows as missed, with what was credited', async () => {
  const dir = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'pd-farm-hist-'));
  const archive = new DropArchive(dir, {});
  const { farmer } = setup({ campaigns: [campaign('a')], streams: {}, units: {} }, {}, { archive });
  archive.backfill([{ t: Date.now() - 3600_000, type: 'watch-start', campaignIds: ['gone'], campaigns: ['Brand Risk'], categoryId: 9, category: 'Special Events' }]);
  await farmer.tick();
  const p = farmer.model.past.find((x) => x.id === 'gone');
  assert.equal(p.status, 'missed');
  assert.equal(p.partial, true);
  assert.equal(p.category, 'Special Events');
  assert.equal(p.units, 0);
});
