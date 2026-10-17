const test = require('node:test');
const assert = require('node:assert/strict');
const { samePage, streamChannel, playerOffline, isPlayer, URLS } = require('../../../src/main/watcher');

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
