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
