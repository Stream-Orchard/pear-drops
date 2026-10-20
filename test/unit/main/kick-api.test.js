const test = require('node:test');
const assert = require('node:assert/strict');
const { assetUrl } = require('../../../src/main/kick-api');

test('assetUrl: Kick paths get the asset host, full URLs and data URIs pass through', () => {
  assert.equal(assetUrl('drops/reward-image/a.png'), 'https://ext.kick.com/drops/reward-image/a.png');
  assert.equal(assetUrl('/drops/a.png'), 'https://ext.kick.com/drops/a.png');
  assert.equal(assetUrl('https://files.kick.com/x.webp'), 'https://files.kick.com/x.webp');
  assert.equal(assetUrl('data:image/svg+xml,abc'), 'data:image/svg+xml,abc');
  assert.equal(assetUrl(''), null);
});

const { KickApi, followsFrom, FOLLOW_APIS } = require('../../../src/main/kick-api');

test('followsFrom reads every shape of Kick follow list', () => {
  assert.deepEqual(followsFrom({ channels: [{ channel_slug: 'Arcadia', is_live: true }, { channel_slug: 'nightowl', is_live: false }], nextCursor: 20 }), [
    { slug: 'arcadia', live: true },
    { slug: 'nightowl', live: false },
  ]);
  assert.deepEqual(followsFrom({ data: [{ slug: 'pixelpear', user: { username: 'PixelPear' }, livestream: null }] }), [{ slug: 'pixelpear', live: false }]);
  assert.deepEqual(followsFrom([{ slug: 'tidepool', followers_count: 3 }]), [{ slug: 'tidepool', live: null }]);
  assert.deepEqual(followsFrom({ data: [{ slug: 'not-a-channel' }] }), [], 'objects that are not channels are ignored');
});

function fakeApi(responses) {
  const api = new KickApi();
  const calls = [];
  api.request = async (url, { query } = {}) => {
    calls.push([url.replace('https://kick.com', ''), query]);
    const r = responses(url.replace('https://kick.com', ''), query);
    if (r instanceof Error) throw r;
    return r;
  };
  return { api, calls };
}

test('followedSlugs pages followed-page and stops at the first page with nobody live', async () => {
  const page = (n, live) => ({ channels: Array.from({ length: 20 }, (_, i) => ({ channel_slug: `ch${n}_${i}`, is_live: live })), nextCursor: (n + 1) * 20 });
  const { api, calls } = fakeApi((url, q) => (url === FOLLOW_APIS[0] ? page(q.cursor / 20, q.cursor < 40) : new Error('unused')));
  const slugs = await api.followedSlugs();
  assert.equal(calls.length, 3, 'two live pages, then one with nobody live');
  assert.equal(slugs.size, 60);
});

test('followedSlugs falls back to the next list when one fails, and stops on a repeated cursor', async () => {
  const gone = Object.assign(new Error('HTTP 404'), { status: 404 });
  const { api, calls } = fakeApi((url, q) => (url === FOLLOW_APIS[0] ? gone : { channels: [{ channel_slug: 'only', followers_count: 1 }], nextCursor: q.cursor }));
  const slugs = await api.followedSlugs();
  assert.deepEqual([...slugs], ['only']);
  assert.equal(calls.filter(([u]) => u === FOLLOW_APIS[1]).length, 1);
});

test('followedSlugs passes a signed-out error up instead of guessing', async () => {
  const { api } = fakeApi(() => Object.assign(new Error('HTTP 401'), { status: 401 }));
  await assert.rejects(api.followedSlugs(), /401/);
});

test("eventOf reads the event from a campaign's url, and only kick.com event pages count", () => {
  const { eventOf } = require('../../../src/main/kick-api');
  assert.equal(eventOf('https://kick.com/events/safe-zone'), 'safe-zone');
  assert.equal(eventOf('https://kick.com/events/01a0a3d9-602d-7db9-84f4-f740827ec04f/'), '01a0a3d9-602d-7db9-84f4-f740827ec04f');
  assert.equal(eventOf('https://www.kick.com/events/x?ref=drops'), 'x');
  assert.equal(eventOf('https://kick.com/category/fortnite'), null);
  assert.equal(eventOf('https://www.lolesports.com'), null);
  assert.equal(eventOf('https://evil.example/kick.com/events/x'), null);
  assert.equal(eventOf(undefined), null);
});

test("eventStreams pages an event's live streams by cursor, as the category list has them, each channel once", async () => {
  const stream = (id, viewers) => ({ channel: { id, slug: `ch${id}`, verified: true }, livestream: { id: `ls${id}`, title: `Stream ${id}`, view_count: viewers, language: 'en', is_mature: false, thumbnail: { src: `https://t/${id}.jpg` } }, user: { id: id + 1000, username: `Ch${id}`, profile_picture_url: `https://p/${id}.png` } });
  const pages = { undefined: { data: { streams: [stream(1, 500), stream(2, 40)], next_cursor: 'p2' } }, p2: { data: { streams: [stream(2, 40), stream(3, 7)], next_cursor: null } } };
  const { api, calls } = fakeApi((url, q) => (url.includes('/events/safe-zone/streams') ? pages[q.cursor] : new Error('unused')));
  const list = await api.eventStreams('safe-zone');
  assert.equal(calls.length, 2, 'until there is no next page');
  assert.deepEqual(list.map((s) => s.channel.id), [1, 2, 3], 'each channel once');
  assert.deepEqual(list[0], { title: 'Stream 1', viewer_count: 500, thumbnail: { src: 'https://t/1.jpg' }, language: 'en', is_mature: false, channel: { id: 1, slug: 'ch1', username: 'Ch1', profile_pic: 'https://p/1.png' }, fromEvent: true });
});

test('signing out: the pages using the login close first, then its data, cache and saved HTTP logins go, and the cookie file is written', async () => {
  const { wipeSession } = require('../../../src/main/kick-api');
  const steps = [];
  const step = (name, fail = false) => async () => {
    steps.push(name);
    if (fail) throw new Error(`${name} failed`);
  };
  const ses = { clearStorageData: step('storage'), clearCache: step('cache', true), clearAuthCache: step('auth'), cookies: { flushStore: step('flush') } };
  await wipeSession({ ses, closePages: step('close pages', true) });
  assert.deepEqual(steps, ['close pages', 'storage', 'cache', 'auth', 'flush'], 'in order, and one failing step doesn’t stop the rest');
});

test('the daily reward’s requests: Kick’s five gamification endpoints, and a claim only by POST', async () => {
  const api = new KickApi();
  const calls = [];
  api.request = async (url, opts = {}) => {
    calls.push([url.replace('https://web.kick.com/api/v1/gamification', ''), opts.method ?? 'GET', opts.query]);
    return { data: [] };
  };
  await api.dailyChallenges();
  await api.dailyChallenges({ recurrence: 'one_off' });
  await api.collectibles();
  await api.level();
  await api.streak(4242);
  await api.claimDaily('ch 1');
  assert.deepEqual(calls, [
    ['/challenges', 'GET', undefined],
    ['/challenges', 'GET', { recurrence: 'one_off' }],
    ['/collectibles', 'GET', undefined],
    ['/user/level', 'GET', undefined],
    ['/users/4242/streak', 'GET', undefined],
    ['/challenges/ch%201/claim', 'POST', undefined],
  ]);
});
