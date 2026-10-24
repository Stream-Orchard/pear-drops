const test = require('node:test');
const assert = require('node:assert/strict');
const dr = require('../../../src/main/daily-reward');
const { DailyReward, OPENED_MS } = dr;

const MIN = 60_000;
const DAY = 86_400_000;
const NOW = Date.parse('2026-10-20T20:00:00Z');
const TABLE = [
  { rarity: 'common', weighting: 550000 },
  { rarity: 'uncommon', weighting: 280000 },
  { rarity: 'rare', weighting: 120000 },
  { rarity: 'epic', weighting: 47000 },
  { rarity: 'legendary', weighting: 2995 },
  { rarity: 'mythic', weighting: 5 },
];

/** A challenge shaped like Kick's reply (sanitised: made-up ids). */
function challenge({ status = 'in_progress', progress = 37, id = 'ch-1', recurrence = 'daily', type = 'watch_time_minutes', ...rest } = {}) {
  return {
    id,
    name: 'Daily Reward',
    recurrence,
    status,
    featured: false,
    condition: { type, progress, threshold: 60 },
    window: { starts_at: '2026-10-20T00:00:00Z', ends_at: '2026-10-21T00:00:00Z' },
    drop_table: TABLE,
    animations: { idle_url: 'https://static.kick.com/rewards/daily-rewards/idle', unbox_url: 'https://static.kick.com/rewards/daily-rewards/unbox' },
    ...rest,
  };
}
const CARDS = [
  { id: 'c1', type: 'emote', rarity: 'common', card_url: 'https://ext.cdn.kick.com/c1.webp', owned: true },
  { id: 'c2', type: 'emote', rarity: 'common', card_url: 'https://ext.cdn.kick.com/c2.webp', owned: false },
  { id: 'u1', type: 'badge', rarity: 'uncommon', card_url: 'https://ext.cdn.kick.com/u1.webp', owned: true },
  { id: 'r1', type: 'emote', rarity: 'rare', card_url: 'https://ext.cdn.kick.com/r1.webp', owned: false },
];

/** A stand-in for kick-api.js's daily reward calls, counting each. */
function fakeKick({ challenges = [challenge()], oneOff = [], claim, fail = null } = {}) {
  const calls = { challenges: 0, oneOff: 0, cards: 0, level: 0, streak: 0, claim: 0 };
  const kick = {
    calls,
    challenges,
    async dailyChallenges(query) {
      if (fail) throw fail;
      if (query?.recurrence === 'one_off') {
        calls.oneOff++;
        return { data: oneOff, message: 'success' };
      }
      calls.challenges++;
      return { data: kick.challenges, message: 'success' };
    },
    async collectibles() {
      calls.cards++;
      return { data: CARDS, message: 'success' };
    },
    async level() {
      calls.level++;
      return { data: { level: 65, progress_xp: 1544, xp_to_next_level: 14369, total_xp: 335952, badge: { image_url: 'https://files.kick.com/badge.png' } }, message: 'success' };
    },
    async streak(id) {
      calls.streak++;
      assert.equal(id, 4242);
      return { data: { length_days: 111 }, message: 'success' };
    },
    async claimDaily(id) {
      calls.claim++;
      // As Kick does: the challenge is claimed from then on.
      kick.challenges = kick.challenges.map((c) => (c.id === id ? { ...c, status: 'claimed' } : c));
      return claim ? claim(id) : { data: { reveal_type: 'roulette', roulette: [{ id: 'c1', item_url: 'https://ext.cdn.kick.com/c1.webp' }, { id: 'r1', item_url: 'https://ext.cdn.kick.com/r1.webp' }], winner: { id: 'r1', rarity: 'rare', type: 'emote', card_url: 'https://ext.cdn.kick.com/r1.webp' }, consolation: null } };
    },
  };
  return kick;
}

/** Timers that only run when told to. */
function fakeTimers() {
  const list = [];
  return {
    list,
    set(fn, ms) {
      const t = { fn, ms };
      list.push(t);
      return t;
    },
    clear(t) {
      const i = list.indexOf(t);
      if (i >= 0) list.splice(i, 1);
    },
    get next() {
      return list.at(-1)?.ms;
    },
  };
}

function setup({ kick = fakeKick(), settings = {}, watching = true, saved = {}, now = NOW } = {}) {
  const timers = fakeTimers();
  const events = [];
  const stored = { value: saved };
  const clock = { now };
  const reward = new DailyReward({
    kick,
    slot: { load: () => stored.value, save: (v) => (stored.value = v) },
    settings: () => settings,
    watching: () => watching,
    userId: () => 4242,
    history: { add: (type, data) => events.push({ type, ...data }) },
    now: () => clock.now,
    timers,
  });
  const emitted = [];
  for (const e of ['ready', 'reminder', 'claimed', 'auth-lost']) reward.on(e, (x) => emitted.push([e, x]));
  return { reward, kick, timers, events, stored, emitted, clock };
}

const settle = () => new Promise((r) => setImmediate(r));

test('odds come from Kick’s weights, rarity by rarity', () => {
  const odds = dr.oddsOf(TABLE);
  assert.deepEqual(
    odds.map((o) => o.rarity),
    ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'],
  );
  assert.equal(odds[0].chance, 0.55);
  assert.equal(odds[5].chance, 0.000005);
  assert.deepEqual(dr.oddsOf([]), []);
  assert.deepEqual(dr.oddsOf([{ rarity: 'shiny', weighting: 5 }]), []);
});

test('a challenge reads as earning, ready or claimed, with its minutes and Kick’s videos', () => {
  const earning = dr.readChallenge(challenge());
  assert.equal(earning.state, 'earning');
  assert.equal(earning.minutes, 37);
  assert.equal(earning.endsAt, Date.parse('2026-10-21T00:00:00Z'));
  assert.equal(earning.media.idle, 'https://static.kick.com/rewards/daily-rewards/idle.webm');
  assert.equal(dr.readChallenge(challenge({ status: 'claimable', progress: 60 })).state, 'ready');
  assert.equal(dr.readChallenge(challenge({ status: 'claimed' })).state, 'claimed');
  assert.equal(dr.readChallenge(challenge({ progress: 99 })).minutes, 60, 'never more than the hour');
  assert.equal(dr.readChallenge(null), null);
  // Only Kick's own media host; anything else falls back to Kick's defaults.
  assert.equal(dr.mediaUrl('https://example.com/x', 'https://static.kick.com/rewards/daily-rewards/unbox'), 'https://static.kick.com/rewards/daily-rewards/unbox.webm');
  assert.equal(dr.mediaUrl('https://static.kick.com/a.mp4', 'x'), 'https://static.kick.com/a.mp4');
});

test('the daily challenge is told apart from the others, and only those Pear Drops can act on are listed', () => {
  const welcome = challenge({ id: 'w', recurrence: 'one_off', type: 'onboarding_completed', progress: 0 });
  const event = challenge({ id: 'e', recurrence: 'one_off', progress: 12 });
  const done = challenge({ id: 'd', recurrence: 'one_off', status: 'claimed' });
  const read = dr.readChallenges({ data: [challenge(), event] }, { data: [welcome, done] });
  assert.equal(read.daily.id, 'ch-1');
  assert.deepEqual(
    read.extras.map((e) => [e.id, e.state]),
    [['e', 'earning']],
    'an event crate filling as you watch; not the Welcome Reward waiting on Kick’s sign-up steps (no link reaches them), nor one claimed',
  );
  const ready = dr.readChallenges({ data: [challenge()] }, { data: [{ ...welcome, status: 'claimable' }] });
  assert.deepEqual(
    ready.extras.map((e) => [e.id, e.state]),
    [['w', 'ready']],
    'the Welcome Reward once it can be claimed',
  );
  assert.equal(dr.readChallenges({ data: [] }).daily, null);
  assert.equal(dr.unwrap([1]).length, 1, 'a bare list is a list');
});

test('the collection counts cards by rarity, and the duplicate chance weighs what you own', () => {
  const c = dr.collectionOf({ data: CARDS });
  assert.equal(c.owned, 2);
  assert.equal(c.total, 4);
  assert.deepEqual(c.byRarity.common, { owned: 1, total: 2 });
  assert.deepEqual(c.byRarity.mythic, { owned: 0, total: 0 });
  const odds = [
    { rarity: 'common', chance: 0.5 },
    { rarity: 'uncommon', chance: 0.3 },
    { rarity: 'rare', chance: 0.2 },
  ];
  // common: 0.5 × 1/2, uncommon: 0.3 × 1/1, rare: 0.2 × 0/1
  assert.equal(Number(dr.duplicateChance(odds, c.byRarity).toFixed(4)), 0.55);
  assert.equal(dr.duplicateChance(odds, {}), 0);
});

test('a card has no name: its picture shows it', () => {
  assert.deepEqual(dr.cardOf({ id: 7, rarity: 'epic', type: 'badge', card_url: 'https://ext.cdn.kick.com/x.webp' }), { id: '7', rarity: 'epic', type: 'badge', image: 'https://ext.cdn.kick.com/x.webp', square: false });
  // An event's prize: no card picture, a square thumbnail, and no type (unless the card list knows it).
  const prize = dr.cardOf({ id: 'p1', rarity: 'uncommon', card_url: '', thumbnail_url: 'https://content.kick.com/public/rewards/thumbnails/p1.webp' });
  assert.deepEqual([prize.image, prize.square, prize.type], ['https://content.kick.com/public/rewards/thumbnails/p1.webp', true, null]);
  assert.equal(dr.cardOf({ id: 'c1', rarity: 'common', card_url: 'https://a/c1' }, new Map([['c1', 'badge']])).type, 'badge');
  assert.equal(dr.cardOf({ id: 1, rarity: 'odd', card_url: 'http://insecure' }).image, null);
  assert.equal(dr.cardOf({ id: 1, rarity: 'odd' }).rarity, 'common');
  assert.equal(dr.cardOf(null), null);
});

test('the reel puts the winner where Kick did, and adds it when Kick left it out', () => {
  const rarities = new Map([
    ['c1', 'common'],
    ['r1', 'rare'],
  ]);
  const reply = { data: { roulette: [{ id: 'c1', item_url: 'https://a/c1' }, { id: 'r1', item_url: 'https://a/r1' }], winner: { id: 'r1', rarity: 'rare', card_url: 'https://a/r1' } } };
  const reel = dr.reelOf(reply, rarities);
  assert.equal(reel.winnerIndex, 1);
  assert.deepEqual(
    reel.items.map((t) => t.rarity),
    ['common', 'rare'],
  );
  assert.equal(reel.duplicate, false);
  const missing = dr.reelOf({ data: { roulette: [{ id: 'c1', item_url: 'https://a/c1' }], winner: { id: 'x9', rarity: 'epic', card_url: 'https://a/x9' } } });
  assert.equal(missing.items.length, 2);
  assert.equal(missing.winnerIndex, 1);
  assert.equal(missing.items[1].rarity, 'epic');
  const dupe = dr.reelOf({ data: { roulette: [], winner: { id: 'c1', rarity: 'common', card_url: 'https://a/c1' }, consolation: { watch_time_minutes: 12, next_level_badge: { metadata: { level: 66 } } }, reveal_type: 'instant' } });
  assert.deepEqual([dupe.duplicate, dupe.xpMinutes, dupe.levelTo, dupe.revealType], [true, 12, 66, 'instant']);
});

test('the level is a share of the way to the next, as kick.com shows it', () => {
  assert.deepEqual(dr.levelOf({ data: { level: 65, progress_xp: 1544, xp_to_next_level: 14369, badge: { image_url: 'https://files.kick.com/b.png' } } }), { level: 65, progress: 1544, toNext: 14369, badge: 'https://files.kick.com/b.png' });
  assert.equal(dr.levelOf({ data: {} }), null);
});

test('a claim is recorded in History in words, with the card’s picture', () => {
  assert.deepEqual(dr.claimText({ winner: { rarity: 'rare', type: 'emote' }, duplicate: false }), { reward: 'Rare emote', text: 'Rare emote, new to your collection' });
  assert.equal(dr.claimText({ winner: { rarity: 'common', type: 'badge' }, duplicate: true, xpMinutes: 12, levelTo: 66 }).text, 'Common badge, a duplicate, +12 min watch time to Level 66');
  assert.equal(dr.claimText({ winner: null, duplicate: true }).text, 'Common reward, a duplicate');
  assert.deepEqual(dr.claimText({ winner: { rarity: 'uncommon', type: null }, duplicate: false }, 'Trick or Treat'), { reward: 'Uncommon reward', text: 'Trick or Treat: Uncommon reward, new to your collection' });
});

test('Kick is asked often while the hour is earned here, rarely otherwise, and again at the reset', () => {
  const daily = dr.readChallenge(challenge());
  assert.equal(dr.nextCheckIn({ daily, watching: true, now: NOW }), 2 * MIN);
  assert.equal(dr.nextCheckIn({ daily, watching: false, now: NOW }), 10 * MIN);
  // Nearly there: right when the hour should be done.
  assert.equal(dr.nextCheckIn({ daily: { ...daily, minutes: 59 }, watching: true, now: NOW }), 90_000);
  const claimed = dr.readChallenge(challenge({ status: 'claimed' }));
  assert.equal(dr.nextCheckIn({ daily: claimed, watching: true, now: NOW }), 4 * 60 * MIN + 5000);
  // Near the reset, the reset comes first.
  assert.equal(dr.nextCheckIn({ daily, watching: false, now: claimed.endsAt - 60_000 }), 65_000);
  assert.equal(dr.nextCheckIn({ daily: null, watching: true, now: NOW }), 10 * MIN);
  assert.equal(dr.nextCheckIn({ daily, watching: true, now: NOW, error: true }), 3 * MIN);
});

test('starting reads everything once; later checks only ask for the challenge', async () => {
  const { reward, kick, timers } = setup();
  reward.start();
  await settle();
  assert.deepEqual(kick.calls, { challenges: 1, oneOff: 1, cards: 1, level: 1, streak: 1, claim: 0 });
  const s = reward.snapshot();
  assert.equal(s.state, 'earning');
  assert.equal(s.minutes, 37);
  assert.equal(s.streak, 111);
  assert.equal(s.level.level, 65);
  assert.equal(s.collection.owned, 2);
  assert.ok(s.duplicateChance > 0);
  assert.equal(s.claimMode, 'before-reset');
  assert.equal(timers.next, 2 * MIN);
  await reward.refresh();
  assert.equal(kick.calls.challenges, 2);
  assert.equal(kick.calls.cards, 1, 'the card list waits for a claim or a few hours');
  reward.start();
  assert.equal(kick.calls.challenges, 2, 'starting twice does nothing');
  reward.stop();
  assert.equal(reward.snapshot(), null);
  assert.equal(timers.list.length, 0);
});

test('a claimable Welcome Reward is kept between the checks that leave it out', async () => {
  const kick = fakeKick({ oneOff: [challenge({ id: 'w', recurrence: 'one_off', type: 'onboarding_completed', status: 'claimable', progress: 1 })] });
  const { reward } = setup({ kick });
  reward.start();
  await settle();
  await reward.refresh();
  assert.deepEqual(
    reward.snapshot().extras.map((e) => e.id),
    ['w'],
  );
});

test('the hour done: "ready" is said once, and Kick’s realtime event asks again at once', async () => {
  const { reward, kick, timers, emitted } = setup();
  reward.start();
  await settle();
  reward.goalReached();
  assert.equal(timers.next, 1500);
  kick.challenges = [challenge({ status: 'claimable', progress: 60 })];
  await reward.refresh();
  await reward.refresh();
  assert.deepEqual(
    emitted.map(([e]) => e),
    ['ready'],
  );
  assert.equal(reward.snapshot().state, 'ready');
});

test('watching again while the hour is earned asks Kick soon', async () => {
  const { reward, timers } = setup();
  reward.start();
  await settle();
  reward.watchingStarted();
  assert.equal(timers.next, 5000);
});

test('the card opened asks Kick at once, unless it just did or a claim is under way', async () => {
  const { reward, kick, timers, clock } = setup();
  reward.opened();
  assert.equal(kick.calls.challenges, 0, 'not before it starts');
  reward.start();
  await settle();
  reward.opened();
  assert.equal(kick.calls.challenges, 1, 'it just asked');
  clock.now += OPENED_MS;
  reward.opened();
  await settle();
  assert.equal(kick.calls.challenges, 2);
  assert.equal(kick.calls.cards, 1, 'only the challenge');
  assert.equal(timers.list.length, 1, 'and the next check after it');
  clock.now += OPENED_MS;
  reward.claiming = true;
  reward.opened();
  assert.equal(kick.calls.challenges, 2, 'a claim reads it again itself');
});

test('a claim plays Kick’s reel, records it, keeps it for Replay, and reads the cards again', async () => {
  const kick = fakeKick({ challenges: [challenge({ status: 'claimable', progress: 60 })] });
  const { reward, events, stored, emitted } = setup({ kick, settings: { dailyClaim: 'self' } });
  reward.start();
  await settle();
  const reel = await reward.claim();
  assert.equal(reel.winner.rarity, 'rare');
  assert.equal(reel.items[reel.winnerIndex].rarity, 'rare');
  assert.equal(events[0].type, 'daily-reward');
  assert.equal(events[0].text, 'Rare emote, new to your collection');
  assert.equal(events[0].by, 'you');
  assert.equal(stored.value.day, '2026-10-20');
  assert.deepEqual(emitted.at(-1)[0], 'claimed');
  assert.equal(reward.snapshot().state, 'claimed');
  assert.deepEqual(reward.lastClaim(), reel);
  await settle();
  assert.equal(kick.calls.cards, 2);
  const today = reward.snapshot().today;
  assert.equal(today.winner.rarity, 'rare');
  assert.equal(today.replay, true);
  assert.equal(today.by, 'you');
});

test('Replay survives a restart the same day, not the next', async () => {
  const saved = { day: '2026-10-20', by: 'auto', reel: { items: [{ image: 'https://a', rarity: 'epic' }], winnerIndex: 0, winner: { rarity: 'epic', type: 'emote', image: 'https://a' }, duplicate: false } };
  const kick = fakeKick({ challenges: [challenge({ status: 'claimed' })] });
  const { reward } = setup({ kick, saved });
  reward.start();
  await settle();
  assert.equal(reward.lastClaim().winner.rarity, 'epic');
  assert.equal(reward.snapshot().today.by, 'auto');
  kick.challenges = [challenge({ status: 'claimed', window: { starts_at: '2026-10-21T00:00:00Z', ends_at: '2026-10-22T00:00:00Z' } })];
  await reward.refresh();
  assert.equal(reward.lastClaim(), null);
});

test('claimed on kick.com: the card shows what Kick says, and nothing to replay', async () => {
  const kick = fakeKick({ challenges: [challenge({ status: 'claimed', winner: { id: 'c1', rarity: 'common', type: 'emote', card_url: 'https://a/c1' }, consolation: { watch_time_minutes: 12 } })] });
  const { reward } = setup({ kick });
  reward.start();
  await settle();
  const t = reward.snapshot().today;
  assert.deepEqual([t.winner.rarity, t.duplicate, t.by, t.replay], ['common', true, 'elsewhere', false]);
});

test('already claimed elsewhere: no error, the card catches up', async () => {
  const kick = fakeKick({ challenges: [challenge({ status: 'claimable', progress: 60 })] });
  kick.claimDaily = async () => {
    kick.challenges = [challenge({ status: 'claimed' })];
    throw Object.assign(new Error('HTTP 400'), { status: 400 });
  };
  const { reward, events } = setup({ kick, settings: { dailyClaim: 'self' } });
  reward.start();
  await settle();
  assert.deepEqual(await reward.claim(), { alreadyClaimed: true });
  assert.equal(events.length, 0);
  assert.equal(reward.snapshot().state, 'claimed');
});

test('a claim Kick refuses says so, and nothing is claimed twice at once', async () => {
  const kick = fakeKick({ challenges: [challenge({ status: 'claimable', progress: 60 })] });
  let release;
  kick.claimDaily = () => new Promise((_, reject) => (release = () => reject(Object.assign(new Error('HTTP 500'), { status: 500 }))));
  const { reward } = setup({ kick, settings: { dailyClaim: 'self' } });
  reward.start();
  await settle();
  const first = reward.claim();
  assert.ok((await reward.claim()).error, 'a second claim waits its turn');
  assert.equal(reward.snapshot().claiming, true);
  release();
  assert.match((await first).error, /didn’t accept/);
  assert.deepEqual(await new DailyReward({ kick, slot: null, settings: () => ({}), watching: () => false, userId: () => null }).claim(), { error: 'There’s no daily reward to claim.' });
});

test('a lost login while claiming or checking is passed on', async () => {
  const kick = fakeKick({ challenges: [challenge({ status: 'claimable', progress: 60 })] });
  kick.claimDaily = async () => {
    throw Object.assign(new Error('HTTP 401'), { status: 401 });
  };
  const { reward, emitted } = setup({ kick, settings: { dailyClaim: 'self' } });
  reward.start();
  await settle();
  assert.match((await reward.claim()).error, /sign in/);
  assert.equal(emitted.at(-1)[0], 'auth-lost');
  const off = setup({ kick: fakeKick({ fail: Object.assign(new Error('HTTP 403'), { status: 403 }) }) });
  off.reward.start();
  await settle();
  assert.equal(off.emitted.at(-1)[0], 'auth-lost');
});

test('Kick not answering: "unavailable" at first, and a retry in a few minutes', async () => {
  const { reward, timers } = setup({ kick: fakeKick({ fail: new Error('offline') }) });
  assert.equal(reward.snapshot(), null, 'nothing before it starts');
  reward.start();
  assert.equal(reward.snapshot().state, 'loading');
  await settle();
  assert.equal(reward.snapshot().state, 'unavailable');
  assert.equal(timers.next, 3 * MIN);
});

test('"Right away" claims as soon as it’s ready, once a day', async () => {
  const kick = fakeKick({ challenges: [challenge({ status: 'claimable', progress: 60 })] });
  const { reward, events } = setup({ kick, settings: { dailyClaim: 'now' } });
  reward.start();
  await settle();
  await settle();
  assert.equal(kick.calls.claim, 1);
  assert.equal(events[0].by, 'auto');
  await reward.refresh();
  assert.equal(kick.calls.claim, 1);
});

test('"Before it resets" waits until 15 minutes before midnight UTC, and reminds an hour before', async () => {
  const kick = fakeKick({ challenges: [challenge({ status: 'claimable', progress: 60 })] });
  const { reward, timers, emitted, clock } = setup({ kick });
  reward.start();
  await settle();
  assert.equal(kick.calls.claim, 0);
  const reset = Date.parse('2026-10-21T00:00:00Z');
  assert.equal(timers.next, Math.min(10 * MIN, reset - 60 * MIN - NOW), 'wakes for the reminder, or the next check');
  clock.now = reset - 50 * MIN;
  await reward.refresh();
  assert.deepEqual(
    emitted.map(([e]) => e),
    ['reminder'],
  );
  assert.equal(timers.next, 10 * MIN);
  clock.now = reset - 14 * MIN;
  await reward.refresh();
  await settle();
  assert.equal(kick.calls.claim, 1);
});

test('"Myself" never claims, only reminds', async () => {
  const kick = fakeKick({ challenges: [challenge({ status: 'claimable', progress: 60 })] });
  const { reward, emitted, clock } = setup({ kick, settings: { dailyClaim: 'self' }, now: Date.parse('2026-10-20T23:50:00Z') });
  reward.start();
  await settle();
  assert.equal(kick.calls.claim, 0);
  assert.deepEqual(
    emitted.map(([e]) => e),
    ['reminder'],
  );
  clock.now += 60_000;
  await reward.refresh();
  assert.equal(emitted.length, 1, 'said once');
});

test('an unknown claim setting means the default', () => {
  assert.equal(dr.claimMode({ dailyClaim: 'sometimes' }), 'before-reset');
  assert.equal(dr.claimMode({ dailyClaim: 'self' }), 'self');
  assert.equal(dr.claimMode(null), 'before-reset');
});

test('demo mode draws its own crate; with Kick, its videos', async () => {
  const kick = fakeKick();
  const own = new DailyReward({ kick, slot: null, settings: () => ({}), watching: () => false, userId: () => 1, kickMedia: false, now: () => NOW, timers: fakeTimers() });
  own.start();
  await settle();
  assert.equal(own.snapshot().media, null);
  const { reward } = setup();
  reward.start();
  await settle();
  assert.match(reward.snapshot().media.unbox, /unbox\.webm$/);
  assert.equal(dr.dayOf(NOW + DAY), '2026-10-21');
});

// ------------------------------------------------------------------ an event's crate

/** An event's crate as Kick lists Trick or Treat: another daily challenge, featured, 3 hours, with videos of its own (made-up ids). */
function eventCrate({ status = 'in_progress', progress = 112, id = 'ev-1', name = 'Trick or Treat', ...rest } = {}) {
  return challenge({
    id,
    name,
    status,
    featured: true,
    condition: { type: 'watch_time_minutes', progress, threshold: 180 },
    active_period: { starts_at: '2026-10-20T00:00:00Z', ends_at: '2026-10-28T00:00:00Z' },
    drop_table: [
      { rarity: 'common', weighting: 500 },
      { rarity: 'uncommon', weighting: 299 },
      { rarity: 'rare', weighting: 200 },
      { rarity: 'mythic', weighting: 1 },
    ],
    animations: { idle_url: 'https://static.kick.com/rewards/halloween-2610/idle', unbox_url: 'https://static.kick.com/rewards/halloween-2610/unbox' },
    ...rest,
  });
}
// Kick's reply to an event crate's claim: its prize alone, a square thumbnail, no reel.
const PRIZE = { id: 'p1', rarity: 'uncommon', card_url: '', thumbnail_url: 'https://content.kick.com/public/rewards/thumbnails/p1.webp' };
const prizeClaim = () => ({ data: { reveal_type: 'instant', roulette: [], winner: PRIZE, consolation: null } });

test('an event’s crate is another daily challenge: the plain one is still the daily, whichever comes first', () => {
  const read = dr.readChallenges({ data: [eventCrate(), challenge()] });
  assert.equal(read.daily.id, 'ch-1');
  assert.deepEqual(read.extras.map((e) => [e.id, e.name, e.state, e.threshold]), [['ev-1', 'Trick or Treat', 'earning', 180]]);
  const e = read.extras[0];
  assert.equal(e.until, Date.parse('2026-10-28T00:00:00Z'), 'its event’s end');
  assert.equal(e.media.unbox, 'https://static.kick.com/rewards/halloween-2610/unbox.webm');
  assert.equal(e.ownMedia, true);
  assert.equal(e.theme, 'halloween');
  assert.deepEqual(e.odds.map((o) => o.rarity), ['common', 'uncommon', 'rare', 'mythic']);
  // Claimed today, it stays listed, showing what it gave; a claimed one-off doesn't.
  const claimed = dr.readChallenges({ data: [challenge(), eventCrate({ status: 'claimed', winner: PRIZE })] });
  assert.deepEqual(claimed.extras.map((x) => [x.state, x.winner.image, x.winner.square]), [['claimed', PRIZE.thumbnail_url, true]]);
  assert.equal(dr.readChallenge(challenge({ animations: null })).ownMedia, false, 'Kick’s default videos are the daily crate’s');
});

test('an event’s theme comes from its name or its videos’ folder, or is a plain event', () => {
  assert.equal(dr.themeOf('Trick or Treat', 'https://static.kick.com/rewards/halloween-2610/idle'), 'halloween');
  assert.equal(dr.themeOf('Mystery Box', 'https://static.kick.com/rewards/halloween-2610/idle'), 'halloween', 'the folder says it');
  assert.equal(dr.themeOf('Holiday Cheer', null), 'winter');
  assert.equal(dr.themeOf('Xmas Crate', null), 'winter');
  assert.equal(dr.themeOf('Valentine’s Box', null), 'valentine');
  assert.equal(dr.themeOf('New Year Countdown', null), 'newyear');
  assert.equal(dr.themeOf('Spring Bloom', null), 'spring');
  assert.equal(dr.themeOf('Summer Splash', null), 'summer');
  assert.equal(dr.themeOf('Anniversary', null), 'event');
  assert.equal(dr.themeOf('Anniversary', 'https://example.com/halloween/idle'), 'event', 'only Kick’s own media host');
  assert.equal(dr.themeOf(undefined, undefined), 'event');
});

test('claiming an event’s crate keeps it on the card with its prize, for See it, and records its name', async () => {
  const kick = fakeKick({ challenges: [challenge({ status: 'claimed' }), eventCrate({ status: 'claimable', progress: 180 })], claim: prizeClaim });
  const { reward, events, stored, emitted } = setup({ kick, settings: { dailyClaim: 'self' } });
  reward.start();
  await settle();
  const crate = reward.snapshot().extras[0];
  assert.deepEqual([crate.state, crate.theme, crate.endsAt, crate.until], ['ready', 'halloween', Date.parse('2026-10-21T00:00:00Z'), Date.parse('2026-10-28T00:00:00Z')]);
  assert.match(crate.media.idle, /halloween-2610\/idle\.webm$/);
  const reel = await reward.claim('ev-1');
  assert.deepEqual([reel.items.length, reel.revealType, reel.winner.image, reel.winner.type], [1, 'instant', PRIZE.thumbnail_url, null]);
  assert.equal(events[0].text, 'Trick or Treat: Uncommon reward, new to your collection');
  assert.equal(events[0].crate, 'Trick or Treat');
  assert.equal(emitted.find(([e]) => e === 'claimed')[1].crate, 'Trick or Treat');
  assert.deepEqual(stored.value.events['ev-1'].day, '2026-10-20');
  assert.equal(stored.value.day, undefined, 'the daily crate’s own claim is untouched');
  const after = reward.snapshot().extras[0];
  assert.deepEqual([after.state, after.won.winner.image, after.won.duplicate, after.won.by, after.won.replay], ['claimed', PRIZE.thumbnail_url, false, 'you', true]);
  assert.deepEqual(reward.lastClaim('ev-1'), reel);
  assert.equal(reward.lastClaim(), null, 'not the daily crate’s');
  // Kick lists it as claimed from then on: still there, still with See it.
  await settle();
  await reward.refresh();
  assert.equal(reward.snapshot().extras[0].won.replay, true);
});

test('an event crate’s See it survives a restart the same day, not the next; claimed on kick.com shows Kick’s prize', async () => {
  const reel = { items: [{ image: PRIZE.thumbnail_url, rarity: 'uncommon' }], winnerIndex: 0, winner: { id: 'p1', rarity: 'uncommon', type: null, image: PRIZE.thumbnail_url, square: true }, duplicate: false };
  const kick = fakeKick({ challenges: [challenge({ status: 'claimed' }), eventCrate({ status: 'claimed', winner: PRIZE })] });
  const { reward } = setup({ kick, saved: { events: { 'ev-1': { day: '2026-10-20', reel, by: 'auto' } } } });
  reward.start();
  await settle();
  assert.deepEqual(reward.snapshot().extras[0].won.by, 'auto');
  assert.equal(reward.lastClaim('ev-1').winner.rarity, 'uncommon');
  const next = { starts_at: '2026-10-21T00:00:00Z', ends_at: '2026-10-22T00:00:00Z' };
  kick.challenges = [challenge({ status: 'claimed', window: next }), eventCrate({ status: 'claimed', winner: PRIZE, window: next })];
  await reward.refresh();
  assert.equal(reward.lastClaim('ev-1'), null);
  const won = reward.snapshot().extras[0].won;
  assert.deepEqual([won.winner.image, won.by, won.replay], [PRIZE.thumbnail_url, 'elsewhere', false]);
  assert.equal(reward.lastClaim('nope'), null);
});

test('an event’s crate ready: said once, the chests show it, and the claim setting claims it too', async () => {
  const kick = fakeKick({ challenges: [challenge({ status: 'claimed' }), eventCrate()], claim: prizeClaim });
  const { reward, events, emitted } = setup({ kick, settings: { dailyClaim: 'self' } });
  const ready = [];
  reward.on('crate-ready', (c) => ready.push(c));
  reward.start();
  await settle();
  assert.equal(reward.chest().state, 'claimed');
  assert.equal(reward.snapshot().crateReady, false);
  kick.challenges = [challenge({ status: 'claimed' }), eventCrate({ status: 'claimable', progress: 180 })];
  await reward.refresh();
  await reward.refresh();
  assert.deepEqual(ready, [{ id: 'ev-1', name: 'Trick or Treat', endsAt: Date.parse('2026-10-21T00:00:00Z') }]);
  assert.equal(reward.snapshot().crateReady, true);
  assert.deepEqual([reward.chest().state, reward.chest().crate, reward.chest().theme], ['ready', 'Trick or Treat', 'halloween']);
  assert.equal(emitted.filter(([e]) => e === 'ready').length, 0, 'the daily crate’s "ready" is its own');
  assert.equal(kick.calls.claim, 0, '"Myself": never on its own');
  // "Right away": claimed at once, once.
  const now = setup({ kick: fakeKick({ challenges: [challenge({ status: 'claimed' }), eventCrate({ status: 'claimable', progress: 180 })], claim: prizeClaim }), settings: { dailyClaim: 'now' } });
  now.reward.start();
  await settle();
  await settle();
  assert.equal(now.kick.calls.claim, 1);
  assert.deepEqual([now.events[0].by, now.events[0].crate], ['auto', 'Trick or Treat']);
  assert.equal(events.length, 0);
});

test('"Before it resets" claims a waiting event crate 15 minutes before midnight UTC, after the daily one', async () => {
  const challenges = [challenge({ status: 'claimable', progress: 60 }), eventCrate({ status: 'claimable', progress: 180 })];
  const kick = fakeKick({ challenges, claim: (id) => (id === 'ev-1' ? prizeClaim() : { data: { reveal_type: 'roulette', roulette: [], winner: { id: 'c1', rarity: 'common', card_url: 'https://ext.cdn.kick.com/c1.webp' } } }) });
  const { reward, events, timers, clock } = setup({ kick, now: Date.parse('2026-10-20T23:00:00Z') });
  reward.start();
  await settle();
  assert.equal(kick.calls.claim, 0);
  assert.ok(timers.next <= 45 * MIN, 'wakes for the claim');
  clock.now = Date.parse('2026-10-20T23:46:00Z');
  await reward.refresh();
  for (let i = 0; i < 6; i++) await settle();
  assert.equal(kick.calls.claim, 2);
  assert.deepEqual(events.map((e) => e.crate ?? 'daily'), ['daily', 'Trick or Treat']);
  assert.equal(events[0].text, 'Common emote, new to your collection', 'the card list knows a daily card’s type');
});

test('an event crate filling as you watch is checked as often as the daily hour', () => {
  const daily = dr.readChallenge(challenge({ status: 'claimed' }));
  const crate = dr.readChallenge(eventCrate({ progress: 179 }));
  assert.equal(dr.nextCheckIn({ daily, extras: [crate], watching: true, now: NOW }), 90_000);
  assert.equal(dr.nextCheckIn({ daily, extras: [crate], watching: false, now: NOW }), 10 * MIN);
  assert.equal(dr.nextCheckIn({ daily, extras: [{ ...crate, state: 'claimed' }], watching: true, now: NOW }), 4 * 60 * MIN + 5000);
});
