const test = require('node:test');
const assert = require('node:assert/strict');
const { samePage, streamChannel, URLS } = require('../../../src/main/watcher');

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
});
