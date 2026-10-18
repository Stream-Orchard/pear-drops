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

test('for notifications: a claim, a reward ready to claim by hand, a new drop on Kick, and status changes are announced', async () => {
  const first = campaign('a', { category: { id: 1, name: 'First' }, endsIn: 1 });
  const { farmer, api, watcher } = setup({ campaigns: [first], streams: { 1: [live('one', 1)], 2: [live('two', 2)] }, units: { a: 50 } });
  const heard = { claimed: [], ready: [], 'new-drops': [], 'status-change': [] };
  for (const name of Object.keys(heard)) farmer.on(name, (x) => heard[name].push(x));
  await farmer.tick();
  assert.equal(watcher.watching, 'one');
  assert.deepEqual(heard['new-drops'], [], 'the first look only learns what is there');
  assert.ok(heard['status-change'].some((x) => x.code === 'farming'));

  api.units.a = 60;
  await farmer.tick();
  assert.deepEqual(heard.claimed.map((x) => [x.reward, x.campaign]), [['Hype Emote', 'Campaign a']]);
  assert.deepEqual(heard.ready, [], 'claimed automatically: nothing to tell');
  assert.ok(heard['status-change'].some((x) => x.code === 'done' && x.was === 'farming'), 'all collected');

  // Kick lists a new drop, and with auto-claim off its first reward becomes ready.
  farmer.store.set({ autoClaim: false });
  api.list.push(campaign('b', { category: { id: 2, name: 'Second' }, rewards: [{ id: 'b-r1', name: 'Neon Badge', required_units: 30, image_url: 'x' }] }));
  api.units.b = 0;
  farmer.campaignsAt = 0;
  await farmer.tick();
  assert.deepEqual(heard['new-drops'], [[{ id: 'b', name: 'Campaign b', category: 'Second' }]]);
  api.units.b = 30;
  await farmer.tick();
  assert.deepEqual(heard.ready, [[{ reward: 'Neon Badge', campaign: 'Campaign b', campaignId: 'b' }]]);
  await farmer.tick();
  assert.equal(heard.ready.length, 1, 'told once');
});

test('drops Kick has announced (upcoming) are listed soonest first for Coming soon, kept out of the queue, and told once each', async () => {
  const later = (days) => new Date(Date.now() + days * 86_400_000).toISOString();
  const soon = (id, days, extra = {}) => ({ ...campaign(id, { category: { id: 9, name: 'Pixel Kart' }, ...extra }), status: 'upcoming', starts_at: later(days), ends_at: later(days + 7) });
  const { farmer, api } = setup({ campaigns: [campaign('a'), soon('late', 4), soon('early', 0.5), soon('game', 1, { org: 'Riot Games', connect: 'https://riot', rewards: [{ id: 'g1', name: 'Skin', required_units: 30 }] })], streams: { 1: [live('s', 1)], 9: [live('k', 9)] } });
  const heard = [];
  farmer.on('new-drops', (x) => heard.push(x));
  await farmer.tick();
  assert.deepEqual(farmer.snapshot().upcoming.map((c) => c.id), ['early', 'late'], 'soonest first; game drops only when farmed');
  assert.equal(farmer.snapshot().upcoming[0].watchMinutes, 60);
  assert.ok(!farmer.model.campaigns.some((c) => c.id === 'early'), 'not in the queue until it starts');
  assert.deepEqual(heard, [], 'the first look only learns what is there');

  api.list.push(soon('new', 2));
  farmer.campaignsAt = 0;
  await farmer.tick();
  assert.equal(heard.length, 1);
  assert.equal(heard[0][0].id, 'new');
  assert.ok(heard[0][0].startsAt, 'told as coming, with when it starts');
  farmer.campaignsAt = 0;
  await farmer.tick();
  assert.equal(heard.length, 1, 'told once');
});

test("a drop limited to an event's channels finds them through the event, even ones the category's top streams miss", async () => {
  const c = { ...campaign('ev', { channels: [{ id: 7, slug: 'tiny' }, { id: 8, slug: 'big' }] }), url: 'https://kick.com/events/safe-zone' };
  const { farmer, api, watcher } = setup({ campaigns: [c], streams: { 1: [live('big', 8, 900), live('other', 9, 5000)] } });
  const asked = [];
  const listed = api.livestreams.bind(api);
  api.livestreams = async (cat, opts) => (asked.push(opts.maxPages), listed(cat, opts));
  api.eventStreams = async (event) => {
    assert.equal(event, 'safe-zone');
    return [live('tiny', 7, 3), live('stranger', 99, 50)];
  };
  await farmer.tick();
  const slugs = farmer.model.categories[0].streams.map((s) => s.slug);
  assert.ok(slugs.includes('tiny'), 'the small channel, found through the event');
  assert.ok(!slugs.includes('stranger'), "only the drop's own channels");
  assert.deepEqual(asked, [1], "with the event's list, the category's first page is enough");
  assert.equal(watcher.watching, 'big');

  // Kick doesn't answer for the event: the category is searched deeper, as before.
  api.eventStreams = async () => {
    throw new Error('HTTP 403');
  };
  farmer.streams.clear();
  asked.length = 0;
  await farmer.tick({ force: true });
  assert.deepEqual(asked, [5]);
  assert.ok(farmer.log.some((l) => /Could not list the event's streams \(HTTP 403\)/.test(l.text)));
});

test("a refused claim says why, in Kick's words: a link to connect the game account if that's it, and fewer retries for an invalid one", async () => {
  const { claimFailure } = require('../../../src/main/farmer');
  const refusal = (data, status = 400) => Object.assign(new Error(`HTTP ${status}`), { status, body: data && { data } });
  assert.deepEqual(claimFailure(refusal({ type: 'INVALID_CLAIM' })), { type: 'INVALID_CLAIM', text: 'Kick says this reward can’t be claimed on your account', retryMs: 60 * MIN });
  assert.equal(claimFailure(refusal({ type: 'FAILED_TO_CLAIM', details: 'Try again later' })).text, 'Try again later', "Kick's own details win");
  assert.equal(claimFailure(refusal({ type: 'FAILED_TO_CLAIM' })).retryMs, 10 * MIN);
  const link = claimFailure(refusal({ type: 'INVALID_CLAIM', connect_url: 'https://games.example/link' }));
  assert.equal(link.connectUrl, 'https://games.example/link');
  assert.equal(link.text, 'Kick needs a game account linked first');
  assert.equal(claimFailure(refusal({ type: 'X', connect_url: 'javascript:alert(1)' })).connectUrl, undefined, 'only https links');
  assert.equal(claimFailure(refusal(null, 500)).text, 'Kick refused the claim (HTTP 500)');

  // In the app: the reward shows why, the link is allowed to open, and history notes it once.
  const c = { ...campaign('a', { rewards: [{ id: 'a-r1', name: 'Hype Emote', required_units: 60, image_url: 'x' }] }), url: 'https://kick.com/events/safe-zone' };
  const { farmer, api, history } = setup({ campaigns: [c], streams: { 1: [live('s', 1)] }, units: { a: 60 } });
  api.claim = async () => {
    throw refusal({ type: 'INVALID_CLAIM', connect_url: 'https://games.example/link' });
  };
  await farmer.tick();
  const r = farmer.model.campaigns[0].rewards[0];
  assert.equal(r.claimError.connectUrl, 'https://games.example/link');
  assert.ok(farmer.claimBackoff.get('a-r1') > Date.now() + 59 * MIN, 'an hour before trying again');
  farmer.claimBackoff.clear();
  await farmer.tick();
  assert.equal(history.events.filter((e) => e.type === 'claim-failed').length, 1, 'noted once per reason, not at every retry');
  assert.ok(farmer.knownLinks().has('https://games.example/link'));
  assert.ok(farmer.knownLinks().has('https://kick.com/events/safe-zone'), "the drop's About page");
  assert.ok(!farmer.knownLinks().has('https://evil.example/'));
  assert.equal(farmer.model.campaigns[0].url, 'https://kick.com/events/safe-zone');

  // Refused after the drop's end: too late, said plainly, and not tried again.
  const ended = { ...farmer.model.campaigns[0], endsAt: new Date(Date.now() - MIN).toISOString() };
  const late = farmer.claimRefused(ended, ended.rewards[0], refusal({ type: 'INVALID_CLAIM' }));
  assert.equal(late.text, 'The drop ended before it was claimed');
  assert.equal(farmer.claimBackoff.get('a-r1'), Infinity, 'never retried');
  assert.ok(history.events.some((e) => e.type === 'claim-failed' && e.text === 'Kick refused the claim: The drop ended before it was claimed'));
  farmer.claimBackoff.clear();
  farmer.claimErrors.clear();

  // A claim by hand says why too; a confirmed one clears it.
  assert.deepEqual(await farmer.claimOne('a', 'a-r1'), { error: 'Kick needs a game account linked first', connectUrl: 'https://games.example/link' });
  api.claim = async (cid, rid) => api.claimed.add(rid);
  assert.deepEqual(await farmer.claimOne('a', 'a-r1'), { ok: true });
  assert.equal(farmer.claimErrors.size, 0);
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

test('a raid or the end of a stream (Kick moving the player on) switches to the next stream and is recorded', async () => {
  const { farmer, watcher, history } = setup({ campaigns: [campaign('a')], streams: { 1: [live('one', 1), live('two', 1)] } });
  await farmer.tick();
  const first = watcher.watching;
  watcher.emit('left', { from: 'someone-else', to: 'x' });
  assert.equal(watcher.watching, first, 'only the stream being watched counts');
  watcher.emit('left', { from: first, to: 'pixelpete' });
  await new Promise((r) => setImmediate(r));
  assert.ok(watcher.watching && watcher.watching !== first, `moved on from ${first} to ${watcher.watching}`);
  const ended = history.events.find((e) => e.type === 'offline');
  assert.match(ended.text, /ended the stream and sent viewers to pixelpete/);
  assert.equal(farmer.notice.kind, 'raid');
  assert.match(farmer.notice.text, new RegExp(`raided pixelpete`));
  assert.equal(farmer.notice.slug, first, 'the notice says which stream it was about');
});

test('a sign from the page (the video ended, Kick said it stopped) checks with Kick at once, and an offline stream is left and skipped', async () => {
  const { farmer, watcher, api, history } = setup({ campaigns: [campaign('a')], streams: { 1: [live('first', 1, 500), live('second', 2, 100)] } });
  await farmer.tick();
  assert.equal(watcher.watching, 'first');
  const notices = [];
  farmer.on('notice', (n) => notices.push(n));
  api.offline.add('first'); // the stream list still has it: only the channel check knows
  watcher.emit('hint', { text: 'The video ended' });
  assert.equal(farmer.health().state, 'checking', 'shows as being checked straight away');
  assert.match(farmer.health().text, /The video ended, checking with Kick/);
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 20 && farmer.checking; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(watcher.watching, 'second', 'moved on without waiting for the refresh');
  const ended = history.events.find((e) => e.type === 'offline' && e.slug === 'first');
  assert.match(ended.text, /first: Stream went offline \(spotted: the video ended\)/);
  assert.ok(farmer.blacklist.get('first') > Date.now(), 'skipped a while: the stream list can still have it');
  assert.equal(notices.length, 1);
  assert.equal(notices[0].kind, 'ended');
  assert.equal(farmer.snapshot().notice.slug, 'first');
  farmer.notice.at -= 61_000;
  assert.equal(farmer.snapshot().notice, null, 'the notice shows for a minute');
});

test('quick checks are spaced out, and a check that finds the stream fine changes nothing', async () => {
  const { farmer, watcher, history } = setup({ campaigns: [campaign('a')], streams: { 1: [live('first', 1, 500), live('second', 2, 100)] } });
  await farmer.tick();
  await farmer.checkNow('Kick said the stream stopped');
  assert.equal(watcher.watching, 'first', 'still live: stays');
  assert.equal(farmer.checking, null);
  const before = farmer.lastQuickCheckAt;
  await farmer.checkNow('The video ended');
  assert.equal(farmer.lastQuickCheckAt, before, 'a second sign within 15 s waits for the next one');
  assert.ok(!history.events.some((e) => e.type === 'offline'));
  farmer.paused = true;
  farmer.lastQuickCheckAt = 0;
  await farmer.checkNow('The video ended');
  assert.equal(farmer.lastQuickCheckAt, 0, 'not while paused');
});

test('the stream health: loading, playing, buffering, paused, frozen; a frozen picture is checked, then reloaded after a minute', async () => {
  const { farmer, watcher, history } = setup({ campaigns: [campaign('a')], streams: { 1: [live('first', 1, 500), live('second', 2, 100)] } });
  assert.equal(farmer.health(), null, 'nothing watched');
  await farmer.tick();
  const now = Date.now();
  const ws = watcher.status;
  assert.equal(farmer.health(now).state, 'loading');
  ws.video = { paused: false, readyState: 4, currentTime: 10 };
  assert.equal(farmer.health(now).state, 'playing');
  ws.video = { paused: false, readyState: 2, currentTime: 10 };
  assert.equal(farmer.health(now).state, 'buffering');
  ws.video = { paused: true, readyState: 4, currentTime: 10 };
  assert.equal(farmer.health(now).state, 'paused');
  ws.video = { paused: false, readyState: 4, currentTime: 10 };
  assert.equal(farmer.health(now + 16_000).state, 'frozen', 'says it plays, but the picture has not moved for 15 s');
  assert.match(farmer.health(now + 16_000).text, /hasn't moved for 16s/);

  // The player's reports: a picture stuck past 15 s asks Kick (still live: stays), then a minute in it reloads.
  ws.loadedAt = ws.lastAdvanceAt = now - 70_000;
  farmer.current.lastReloadAt = null;
  watcher.emit('status');
  for (let i = 0; i < 20 && farmer.checking !== null; i++) await new Promise((r) => setTimeout(r, 5));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(watcher.reloads, 1, 'reloaded without waiting for the refresh');
  assert.ok(history.events.some((e) => e.type === 'reload' && /Player is not playing/.test(e.text)));
  assert.equal(farmer.notice.kind, 'reload');
  assert.equal(watcher.watching, 'first');
});

test('the tray icon shows a stream being checked or frozen at once', async () => {
  const { farmer, watcher } = setup({ campaigns: [campaign('a')], streams: { 1: [live('first', 1, 500)] } }, {}, {});
  await farmer.tick();
  watcher.status.video = { paused: false, readyState: 4, currentTime: 1 };
  assert.equal(farmer.trayInfo().tone, 'farming');
  farmer.checking = 'The video ended';
  assert.equal(farmer.trayInfo().tone, 'waiting');
  assert.match(farmer.trayInfo().tooltip, /first: The video ended, checking with Kick/);
  farmer.checking = null;
});

/** Common (category 1, ends in a day) always has a stream on; Rare (2, ends in 3 days) one hour in ten. */
function commonAndRare(settings) {
  const { Availability } = require('../../../src/main/availability');
  const common = campaign('c', { category: { id: 1, name: 'Common' }, endsIn: 1 });
  const rare = campaign('r', { category: { id: 2, name: 'Rare' }, endsIn: 3 });
  const env = setup({ campaigns: [common, rare], streams: { 1: [live('everyday', 1)], 2: [live('sometimes', 2)] } }, { queueMode: 'smart', ...settings });
  const seen = { 1: {}, 2: {} };
  const hour = Math.floor(Date.now() / 3600_000);
  for (let h = 1; h <= 40; h++) {
    seen[1][hour - h] = 1;
    seen[2][hour - h] = h % 10 === 0 ? 1 : 0;
  }
  env.farmer.availability = new Availability(seen);
  return env;
}

test('Smart order catches a rarely live drop while it is on, ahead of a common one that ends sooner', async () => {
  const { farmer, watcher, history } = commonAndRare();
  await farmer.tick();
  const [first, second] = farmer.model.categories;
  assert.equal(first.id, 2, 'Rare first: about 7h of live time left, against a day for Common');
  assert.equal(first.rarelyLive, true);
  assert.equal(second.rarelyLive, false);
  assert.equal(watcher.watching, 'sometimes');
  // Under a week of looks, the reason gives the hours rather than a share of "the past week".
  assert.ok(history.events.some((e) => e.type === 'decision' && /rarely live \(live [45] of the 4[01] hours checked\)/.test(e.text)), 'the pick says why');
});

test('after a week of looks, a rarely live drop is given as a share of the past week', async () => {
  const { farmer, history } = commonAndRare();
  for (let h = 41; h <= 7 * 24 - 1; h++) {
    farmer.availability.note(1, Date.now() - h * 3600_000, true);
    farmer.availability.note(2, Date.now() - h * 3600_000, h % 10 === 0);
  }
  await farmer.tick();
  assert.ok(history.events.some((e) => e.type === 'decision' && /rarely live \(live 1\d% of the past week\)/.test(e.text)));
});

test('watch sessions in the history count as live hours, from before the live rate was saved', () => {
  const { Availability } = require('../../../src/main/availability');
  const { farmer, history } = setup({ campaigns: [], streams: {} });
  const hour = 3600_000;
  const t = Math.floor(Date.now() / hour) * hour - 10 * hour;
  history.events = [
    { t: t + 10 * MIN, type: 'watch-start', session: 's1', categoryId: 7 },
    { t: t + hour + 50 * MIN, type: 'watch-end', session: 's1' }, // two hours touched
    { t: t + 5 * hour, type: 'watch-start', session: 's2' }, // no category: left out
    { t: t + 5 * hour + MIN, type: 'watch-end', session: 's2' },
  ];
  farmer.availability = new Availability({ 7: { [Math.floor(t / hour) + 4]: 0 } });
  farmer.availabilityFromHistory();
  assert.deepEqual(farmer.availability.seen(7), { hours: 3, live: 2, since: t });
  assert.deepEqual(Object.keys(farmer.availability.toJSON()), ['7']);

  // With no startup cache at all, they're still counted.
  farmer.cacheFile = '/nonexistent-dir-for-tests/cache.json';
  assert.equal(farmer.loadCache(), false);
  assert.deepEqual(farmer.availability.seen(7), { hours: 2, live: 2, since: t });
});

test('the stream being watched counts its category as live, even when the listing misses it', async () => {
  const { farmer, api } = setup({ campaigns: [campaign('a')], streams: { 1: [live('first', 1)] } });
  await farmer.tick();
  api.livestreams = async () => [];
  farmer.streams.clear();
  await farmer.refreshStreams({ force: true });
  assert.deepEqual(farmer.availability.seen(1), { hours: 1, live: 1, since: Math.floor(Date.now() / 3600_000) * 3600_000 });
});

test('Favour rarely live drops: Some weighs the live rate less, Off sorts by end time alone', async () => {
  const some = commonAndRare({ smartRarity: 'some' });
  await some.farmer.tick();
  const [rare, common] = [2, 1].map((id) => some.farmer.model.categories.find((c) => c.id === id));
  assert.ok(rare.liveEnd - Date.now() > 0.9 * 86_400_000, 'about a day of live time left at Some, not 7 hours');
  assert.ok(rare.liveEnd < common.liveEnd + 3 * 3600_000);

  const off = commonAndRare({ smartRarity: 'off' });
  await off.farmer.tick();
  assert.equal(off.farmer.model.categories[0].id, 1, 'Common first: it ends sooner');
  assert.equal(off.watcher.watching, 'everyday');
  assert.equal(off.farmer.model.categories[1].rarelyLive, true, 'still shown as rare');
  assert.ok(!off.history.events.some((e) => /rarely live/.test(e.text ?? '')), 'but not given as a reason');
});

test('Switch streams for: Smart only leaves a working stream for a drop with that much less live time left', async () => {
  // Watching Common; Rare comes online with about 7h of live time left against Common's day.
  for (const [minutes, moves] of [[30, true], [24 * 60, false]]) {
    const { farmer, watcher, api } = commonAndRare({ smartHopMinutes: minutes });
    api.offline.add('sometimes');
    await farmer.tick();
    assert.equal(watcher.watching, 'everyday');
    api.offline.delete('sometimes');
    farmer.streams.clear();
    await farmer.tick();
    assert.equal(watcher.watching, moves ? 'sometimes' : 'everyday', `with ${minutes} min`);
  }
});

test('without a week of looks yet, Smart order is soonest-ending first as before', async () => {
  const common = campaign('c', { category: { id: 1, name: 'Common' }, endsIn: 1 });
  const rare = campaign('r', { category: { id: 2, name: 'Rare' }, endsIn: 3 });
  const { farmer } = setup({ campaigns: [common, rare], streams: { 1: [live('everyday', 1)], 2: [live('sometimes', 2)] } }, { queueMode: 'smart' });
  await farmer.tick();
  assert.deepEqual(farmer.model.categories.map((c) => [c.id, c.liveRate]), [[1, null], [2, null]]);
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

test('after a restart the Activity tab carries on from history, in the same words, with credits it can group', () => {
  const { logFromHistory } = require('../../../src/main/farmer');
  const { farmer, history } = setup({ campaigns: [], streams: {} });
  const t = Date.now() - 30 * MIN;
  history.events = [
    { t: t - 7 * 60 * MIN, type: 'watch-start', text: 'Watching Old for Neon Rush' }, // older than 6 h: left out
    { t, type: 'watch-start', text: 'Watching Arcadia for Neon Rush' },
    { t: t + 2 * MIN, type: 'credit', campaign: 'Neon Rush Launch Week', delta: 2, units: 148, text: '+2 min (148 total)' },
    { t: t + 3 * MIN, type: 'claim', text: 'Claimed Hype Rocket Emote (confirmed by Kick)' },
    { t: t + 4 * MIN, type: 'stall', text: 'No progress for 20 min on Arcadia' },
    { t: t + 5 * MIN, type: 'unlock', text: 'Hype Rocket Emote unlocked at 60 min' }, // not a log line
  ];
  farmer.seedFromHistory();
  assert.deepEqual(
    farmer.log.map((l) => [l.level, l.text]),
    [
      ['switch', 'Watching Arcadia for Neon Rush'],
      ['credit', '+2 min on Neon Rush Launch Week (148 total)'],
      ['claim', 'Claimed Hype Rocket Emote (confirmed by Kick)'],
      ['warn', 'No progress for 20 min on Arcadia'],
    ],
  );
  assert.equal(logFromHistory({ t, type: 'credit', delta: 2 }), null, 'a credit without its drop is left out');
  assert.equal(logFromHistory({ t, type: 'conflict', text: 'x' }).level, 'alert');
});

test('the startup cache shows the last known drops at once, and history rebuilds the chart', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pd-cache-')), 'cache.json');
  const first = setup({ campaigns: [campaign('a')], streams: { 1: [live('s', 1)] }, units: { a: 20 } });
  first.farmer.cacheFile = file;
  await first.farmer.tick();
  // The refresh's save, awaited rather than slept on: a slow CI runner can fire the timer late.
  assert.ok(first.farmer.cacheTimer);
  await first.farmer.saveCache();

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
  assert.deepEqual(second.farmer.availability.toJSON(), first.farmer.availability.toJSON(), 'how often each category is live is kept too');
  assert.ok(Object.keys(second.farmer.availability.toJSON()['1']).length, 'the first look was noted');
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

test('a quick restart carries the run on: the stat cards, and the stream being watched', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pd-run-')), 'cache.json');
  const first = setup({ campaigns: [campaign('a')], streams: { 1: [live('s', 1)] }, units: { a: 20 } });
  first.farmer.cacheFile = file;
  await first.farmer.tick();
  const startedAt = first.farmer.current.startedWatchingAt - 40 * MIN; // as if watched for 40 min
  first.farmer.current.startedWatchingAt = startedAt;
  first.history.events.find((e) => e.type === 'watch-start').t = startedAt;
  Object.assign(first.farmer.stats, { sessionStart: startedAt - MIN, watchMs: 40 * MIN, earned: 38, claims: 1 });
  first.watcher.emit('watch-event', { t: Date.now() });
  assert.ok(first.farmer.cacheTimer, 'a watch event saves the count');
  first.farmer.stop();
  first.farmer.flushCache();
  assert.equal(first.farmer.cacheTimer, null);
  await first.farmer.cacheSaved; // the pending save resolves too

  const second = setup({ campaigns: [campaign('a')], streams: { 1: [live('s', 1)] }, units: { a: 22 } });
  second.farmer.cacheFile = file;
  second.history.events = [...first.history.events];
  assert.ok(second.farmer.loadCache());
  const { stats } = second.farmer;
  assert.equal(stats.sessionStart, startedAt - MIN);
  assert.ok(stats.watchMs >= 40 * MIN && stats.watchMs < 41 * MIN, 'the watch time goes on from 40 min');
  assert.equal(stats.earned, 38);
  assert.equal(stats.eventsSent, 1);
  await second.farmer.tick();
  assert.equal(second.farmer.current.startedWatchingAt, startedAt, 'the same stream, watched since before the restart');
  assert.equal(second.farmer.current.campaignSince.a, startedAt);
  second.farmer.stop();
  const end = second.history.events.at(-1);
  assert.equal(end.type, 'watch-end');
  assert.equal(end.minutes, 0, 'History counts each launch\'s own session');

  // A restart long after: a new run, from zero, and the stream starts afresh.
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...saved, savedAt: Date.now() - 20 * MIN }));
  const third = setup({ campaigns: [campaign('a')], streams: { 1: [live('s', 1)] }, units: { a: 22 } });
  third.farmer.cacheFile = file;
  third.history.events = [...first.history.events];
  third.farmer.loadCache();
  assert.equal(third.farmer.stats.earned, 0);
  assert.equal(third.farmer.resumeWatch, undefined);
});

test('a different stream after a quick restart starts its own watch time', async () => {
  const { farmer, history } = setup({ campaigns: [campaign('a')], streams: { 1: [live('other', 1)] } });
  history.events = [
    { t: Date.now() - 30 * MIN, type: 'watch-start', session: 'x', slug: 'gone', campaignIds: ['a'] },
    { t: Date.now() - 2 * MIN, type: 'watch-end', session: 'x', reason: 'App closed or signed out' },
  ];
  farmer.resumeRun({ savedAt: Date.now() - 2 * MIN, stats: { earned: 5, watchMs: 'bad' } });
  assert.equal(farmer.stats.earned, 5);
  assert.equal(farmer.stats.watchMs, 0, 'a bad saved value is left at zero');
  assert.equal(farmer.resumeWatch.slug, 'gone');
  await farmer.tick();
  assert.ok(Date.now() - farmer.current.startedWatchingAt < 5000);
  assert.equal(farmer.resumeWatch, null, 'only the first pick can carry on');
});

test('Claimed today counts the history\'s claims since midnight, so a restart keeps it', () => {
  const { farmer, history } = setup({ campaigns: [], streams: {} });
  const midnight = new Date().setHours(0, 0, 0, 0);
  history.events = [
    { t: midnight - MIN, type: 'claim' },
    { t: midnight + MIN, type: 'claim' },
    { t: midnight + 2 * MIN, type: 'credit' },
    { t: midnight + 3 * MIN, type: 'claim' },
  ];
  assert.equal(farmer.claimsToday(midnight + 4 * MIN), 2);
  assert.equal(farmer.snapshot().stats.claimsToday, farmer.claimsToday());
  farmer.history = null;
  farmer.stats.claims = 3;
  assert.equal(farmer.claimsToday(), 3, 'without a history, this run\'s claims');
});
