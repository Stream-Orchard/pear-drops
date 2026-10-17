const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DropArchive, slim, decodeData } = require('../../../src/main/archive');

const DAY = 86_400_000;
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

function camp(id, { ends = 2, image = `https://files.example/${id}.png` } = {}) {
  return {
    id,
    name: `Campaign ${id}`,
    status: 'active',
    starts_at: new Date(Date.now() - DAY).toISOString(),
    ends_at: new Date(Date.now() + ends * DAY).toISOString(),
    category: { id: 1, name: 'Neon Rush', image_url: 'https://files.example/cat.png' },
    organization: { name: 'KICK', logo_url: null },
    channels: [{ id: 1, slug: 'a' }, { id: 2, slug: 'b' }],
    rewards: [{ id: `${id}-r1`, name: 'Hype Emote', required_units: 60, image_url: image }],
  };
}

function fresh(fetchImage = async () => ({ buffer: PNG, type: 'image/png' })) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kdf-arch-'));
  const fetched = [];
  const archive = new DropArchive(dir, {
    fetchImage: async (url) => {
      fetched.push(url);
      return fetchImage(url);
    },
  });
  return { dir, archive, fetched };
}

test('slim keeps what the app shows, not the channel list', () => {
  const s = slim(camp('a'));
  assert.equal(s.channelCount, 2);
  assert.equal(s.channels, undefined);
  assert.equal(s.rewards[0].image_url, 'https://files.example/a.png');
  assert.equal(s.category.image_url, 'https://files.example/cat.png');
});

test('data: images decode, both base64 and percent-encoded', () => {
  assert.equal(decodeData('data:image/png;base64,aGk=').buffer.toString(), 'hi');
  const svg = decodeData('data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E');
  assert.equal(svg.type, 'image/svg+xml');
  assert.equal(svg.buffer.toString(), '<svg/>');
  assert.equal(decodeData('nope'), null);
});

test('images are stored once and then served from the app, surviving a reload', async () => {
  const { dir, archive, fetched } = fresh();
  archive.update([camp('a')], [], Date.now());
  await archive.pump();
  assert.deepEqual(fetched.sort(), ['https://files.example/a.png', 'https://files.example/cat.png']);
  const local = archive.img('https://files.example/a.png');
  assert.match(local, /^kdf-img:\/\/drop\/[a-f0-9]{24}\.png$/);
  const file = archive.fileFor(local);
  assert.equal(file.type, 'image/png');
  assert.deepEqual(fs.readFileSync(file.path), PNG);
  // Unknown or odd URLs never map to a file.
  for (const bad of ['kdf-img://drop/../drops.json', 'kdf-img://other/abc.png', 'https://x/y.png', 'kdf-img://drop/zz.exe']) assert.equal(archive.fileFor(bad), null, bad);

  archive.update([camp('a')], [], Date.now());
  await archive.pump();
  assert.equal(fetched.length, 2, 'nothing is downloaded twice');
  archive.flush();
  const again = new DropArchive(dir, {}).load();
  assert.equal(again.img('https://files.example/a.png'), local);
  assert.equal(again.get('a').raw.name, 'Campaign a');
});

test('a failed download keeps Kick’s link and waits before trying again', async () => {
  const { archive, fetched } = fresh(async () => {
    throw new Error('offline');
  });
  archive.update([camp('a')], [], Date.now());
  await archive.pump();
  assert.equal(archive.img('https://files.example/a.png'), 'https://files.example/a.png');
  archive.update([camp('a')], [], Date.now());
  await archive.pump();
  assert.equal(fetched.length, 2, 'no immediate retry');
});

test('non-images are refused', async () => {
  const { archive } = fresh(async () => ({ buffer: Buffer.from('<html>'), type: 'text/html' }));
  archive.update([camp('a')], [], Date.now());
  await archive.pump();
  assert.equal(archive.img('https://files.example/a.png'), 'https://files.example/a.png');
});

test('tracks progress and claim times, and drops that end, vanish or come back', () => {
  const { archive } = fresh();
  const now = Date.now();
  const progress = [{ id: 'a', progress_units: 60, rewards: [{ id: 'a-r1', claimed: true, progress: 1 }] }];
  assert.deepEqual(archive.update([camp('a'), camp('b')], progress, now), { ended: [], back: [] });
  assert.equal(archive.get('a').claimedAt['a-r1'], now);
  assert.equal(archive.get('a').progress.units, 60);

  // Kick stops listing b: it's noted as gone, once.
  assert.deepEqual(archive.update([camp('a')], [], now + 1000), { ended: ['b'], back: [] });
  assert.equal(archive.get('b').goneAt, now + 1000);
  assert.equal(archive.get('a').progress.units, 60, 'last known progress is kept');
  assert.deepEqual(archive.update([camp('a')], [], now + 2000), { ended: [], back: [] });

  // b is relisted with a new end date: back.
  assert.deepEqual(archive.update([camp('a'), camp('b', { ends: 3 })], [], now + 3000), { ended: [], back: ['b'] });
  assert.equal(archive.get('b').goneAt, null);

  // a reaches its end date while still listed: ended. Then Kick moves the date: back.
  const over = camp('a', { ends: -0.1 });
  assert.deepEqual(archive.update([over, camp('b')], [], now + 4000), { ended: ['a'], back: [] });
  assert.deepEqual(archive.update([camp('a', { ends: 1 }), camp('b')], [], now + 5000), { ended: [], back: ['a'] });
});

test('old campaigns and the images only they used are pruned', async () => {
  const { archive, dir } = fresh();
  const old = Date.now() - 500 * DAY;
  archive.update([camp('old', { image: 'https://files.example/old.png' })], [], old);
  await archive.pump();
  const name = archive.images['https://files.example/old.png'];
  assert.ok(fs.existsSync(path.join(dir, 'drop-images', name)));
  archive.prune();
  assert.equal(archive.get('old'), null);
  assert.equal(archive.images['https://files.example/old.png'], undefined);
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(!fs.existsSync(path.join(dir, 'drop-images', name)));
});

test('old drops Kick still lists as expired are kept, but not counted as yours or downloaded', async () => {
  const { archive, fetched } = fresh();
  const old = { ...camp('old', { ends: -60, image: 'https://files.example/old.png' }), status: 'expired' };
  old.category = { id: 9, name: 'Old', image_url: 'https://files.example/oldcat.png' };
  archive.update([old, camp('a')], [], Date.now());
  await archive.pump();
  assert.ok(archive.get('old'), 'its details are kept');
  assert.equal(archive.involved(archive.get('old')), false);
  assert.equal(archive.involved(archive.get('a')), true, 'seen while running');
  assert.ok(!fetched.includes('https://files.example/old.png'));
  // With progress on your account, it's yours after all.
  archive.update([old], [{ id: 'old', progress_units: 20, rewards: [] }], Date.now());
  await archive.pump();
  assert.equal(archive.involved(archive.get('old')), true);
  assert.ok(fetched.includes('https://files.example/old.png'));
});

test('drops only the history knows about are rebuilt from it, and become real ones if Kick lists them', () => {
  const { archive } = fresh();
  const t = Date.now() - 3600_000;
  const events = [
    { t, type: 'watch-start', campaignIds: ['gone', 'a'], campaigns: ['Brand Risk', 'Campaign a'], categoryId: 7, category: 'Special Events' },
    { t: t + 60_000, type: 'credit', campaignId: 'gone', campaign: 'Brand Risk', categoryId: 7, category: 'Special Events', units: 4, delta: 2 },
    { t: t + 120_000, type: 'claim', campaignId: 'gone', campaign: 'Brand Risk', categoryId: 7, rewardId: 'r1', reward: 'Risky Emote', rewardImage: 'kdf-img://drop/aaaaaaaaaaaaaaaaaaaaaaaa.png', required: 2 },
    { t, type: 'start' },
  ];
  archive.update([camp('a')], [], t);
  assert.equal(archive.backfill(events), 1, 'only the drop the archive never saw');
  const e = archive.get('gone');
  assert.equal(e.fromHistory, true);
  assert.equal(e.raw.name, 'Brand Risk');
  assert.equal(e.raw.category.name, 'Special Events');
  assert.equal(e.progress.units, 4);
  assert.deepEqual(e.raw.rewards.map((r) => r.name), ['Risky Emote']);
  assert.equal(archive.img(e.raw.rewards[0].image_url), 'kdf-img://drop/aaaaaaaaaaaaaaaaaaaaaaaa.png', 'stored copies pass straight through');
  assert.ok(archive.involved(e));
  assert.ok(archive.over(e));
  assert.equal(archive.backfill(events), 0, 'only once');
  // Kick lists it after all: a real entry now, not "back on Kick".
  assert.deepEqual(archive.update([camp('a'), { ...camp('gone'), name: 'Brand Risk' }], [], Date.now()), { ended: [], back: [] });
  assert.equal(archive.get('gone').fromHistory, undefined);
  assert.equal(archive.get('gone').goneAt, null);
});
