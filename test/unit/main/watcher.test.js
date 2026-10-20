const test = require('node:test');
const assert = require('node:assert/strict');
const { samePage, streamChannel, playerOffline, isPlayer, realtimeHint, URLS } = require('../../../src/main/watcher');

test('a page that only rewrites its query or hash is still the same page', () => {
  assert.equal(samePage(URLS.player('arcadia'), 'https://player.kick.com/arcadia'), true);
  assert.equal(samePage('https://kick.com/arcadia', 'https://kick.com/Arcadia/#chat'), true);
  assert.equal(samePage('https://kick.com/popout/arcadia/chat', 'https://kick.com/popout/arcadia/chat?x=1'), true);
});

test('a different page, or a different site, is not', () => {
  assert.equal(samePage(URLS.player('arcadia'), URLS.player('pixelpete')), false, 'another stream');
  assert.equal(samePage('https://kick.com/arcadia', 'https://kick.com/arcadia/videos'), false);
  assert.equal(samePage('https://kick.com/arcadia', 'https://player.kick.com/arcadia'), false);
  assert.equal(samePage('', 'https://kick.com/arcadia'), false, 'nothing loaded yet');
});

test('Kick stream pages are recognised by their channel: the embed, the popout chat and the channel page', () => {
  assert.equal(streamChannel('https://player.kick.com/pixelpete?autoplay=true'), 'pixelpete');
  assert.equal(streamChannel('https://kick.com/popout/pixelpete/chat'), 'pixelpete');
  assert.equal(streamChannel('https://kick.com/pixelpete'), 'pixelpete');
  assert.equal(streamChannel('https://kick.com/browse'), null, 'a Kick page, not a channel');
  assert.equal(streamChannel('https://kick.com/category/just-chatting'), null);
  assert.equal(streamChannel('https://kick.com/pixelpete/videos'), null);
  assert.equal(streamChannel('https://example.com/pixelpete'), null);
  assert.equal(streamChannel('not a url'), null);
  assert.equal(streamChannel('https://player.kick.com/pixelpete/offline'), 'pixelpete', "the player's own screen for an ended stream");
  assert.equal(streamChannel('https://player.kick.com/video/abc'), null, 'not a channel');
});

test("the player's offline screen is recognised, and no player address counts as a link", () => {
  assert.equal(playerOffline('https://player.kick.com/pixelpete/offline'), true);
  assert.equal(playerOffline('https://player.kick.com/pixelpete/offline/?x=1'), true);
  assert.equal(playerOffline('https://player.kick.com/pixelpete'), false);
  assert.equal(playerOffline('https://kick.com/pixelpete/offline'), false, 'only the player');
  assert.equal(playerOffline('nope'), false);
  assert.equal(isPlayer('https://player.kick.com/anything/at/all'), true);
  assert.equal(isPlayer('https://kick.com/pixelpete'), false);
  assert.equal(isPlayer('nope'), false);
});

test("Kick's realtime events about the stream are signs to check it; chat and the rest are not", () => {
  assert.deepEqual(realtimeHint({ event: 'App\\Events\\StopStreamBroadcast' }), { kind: 'ended', text: 'Kick said the stream stopped' });
  assert.equal(realtimeHint({ event: 'App\\Events\\ChatMoveToSupportedChannelEvent', target: 'pixelpete' }).text, 'Kick said the stream is raiding pixelpete');
  assert.equal(realtimeHint({ event: 'App\\Events\\StreamHostEvent' }).kind, 'raid');
  assert.equal(realtimeHint({ event: 'App\\Events\\LivestreamUpdated' }).kind, 'changed');
  assert.equal(realtimeHint({ event: 'App\\Events\\ChatMessageEvent' }), null);
  assert.equal(realtimeHint({}), null);
  assert.equal(realtimeHint(), null);
});

test("the page's reports: a video that ended or failed, and Kick's realtime events, become hints", () => {
  const { EventEmitter } = require('node:events');
  const { Watcher } = require('../../../src/main/watcher');
  const page = Object.assign(new EventEmitter(), { slug: 'arcadia', status: { eventsSent: 0, handshakes: 0, video: null } });
  const hints = [];
  page.on('hint', (h) => hints.push(h.text));
  const report = (msg) => Watcher.prototype.handlePageMessage.call(page, msg);
  report({ kind: 'hint', reason: 'video-ended' });
  report({ kind: 'hint', reason: 'video-error' });
  report({ kind: 'hint', reason: 'something-else' });
  report({ kind: 'realtime', event: 'App\\Events\\StopStreamBroadcast' });
  report({ kind: 'realtime', event: 'App\\Events\\ChatMessageEvent' });
  assert.deepEqual(hints, ['The video ended', 'The video failed', 'Kick said the stream stopped']);
  page.slug = null;
  report({ kind: 'realtime', event: 'App\\Events\\StopStreamBroadcast' });
  assert.equal(hints.length, 3, 'nothing watched: nothing to check');
  // The daily reward's hour is done: passed on whatever is watched, and never as a hint.
  const heard = [];
  page.on('gamification', (g) => heard.push(g.event));
  report({ kind: 'realtime', event: 'App\\Events\\GamificationWatchTimeGoalReached' });
  assert.deepEqual(heard, ['GamificationWatchTimeGoalReached']);
  assert.equal(hints.length, 3);
});
