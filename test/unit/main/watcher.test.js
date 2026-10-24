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

// ------------------------------------------------------------------ the stream's <webview>s

const { EventEmitter } = require('node:events');
const { Watcher } = require('../../../src/main/watcher');
const { PARTITION } = require('../../../src/main/kick-api');

/** A page's contents, as far as the watcher uses them (a webview's, or the main window's). */
function fakeContents(id, { type = 'webview', host = null } = {}) {
  const wc = new EventEmitter();
  Object.assign(wc, {
    id,
    loaded: [],
    sent: [],
    muted: false,
    hostWebContents: host,
    getType: () => type,
    isDestroyed: () => false,
    setAudioMuted: (m) => (wc.muted = m),
    setWindowOpenHandler: (fn) => (wc.openHandler = fn),
    loadURL: async (url) => wc.loaded.push(url),
    send: (...a) => wc.sent.push(a),
    insertCSS: async () => {},
    setZoomFactor: () => {},
  });
  return wc;
}
function setupWatcher(settings = {}) {
  const host = fakeContents(1, { type: 'window' });
  const win = { webContents: host, isDestroyed: () => false };
  const all = new Map([[1, host]]);
  const ipc = { handlers: {}, on(name, fn) { this.handlers[name] = fn; } };
  const w = new Watcher(() => win, () => settings, { ipcMain: ipc, contents: { fromId: (id) => all.get(id) ?? null } });
  return { w, host, all, ipc };
}

test('the page is asked for the stream’s <webview>s: the player and, in light mode, its chat; none once closed', () => {
  const { w, host } = setupWatcher();
  w.ensureViews();
  assert.deepEqual(host.sent.at(-1), ['player:spec', { gen: 1, mode: 'light', chat: true, partition: PARTITION }]);
  w.ensureViews();
  assert.equal(host.sent.length, 1, 'asked once');
  w.destroyViews();
  assert.deepEqual(host.sent.at(-1), ['player:spec', null]);
  const full = setupWatcher({ playerMode: 'full' });
  full.w.ensureViews();
  assert.deepEqual(full.host.sent.at(-1)[1], { gen: 1, mode: 'full', chat: false, partition: PARTITION });
});

test('only the <webview>s asked for attach, on Kick’s session, each with its preload, sandboxed and never throttled', () => {
  const { w } = setupWatcher();
  assert.equal(w.allowAttach({}, { src: 'about:blank#player', partition: PARTITION }), false, 'none asked for yet');
  w.ensureViews();
  const prefs = { preload: '/elsewhere.js', nodeIntegration: true, sandbox: false, webSecurity: false, contextIsolation: false, plugins: true };
  const params = { src: 'about:blank#player', partition: PARTITION };
  assert.equal(w.allowAttach(prefs, params), true);
  assert.match(prefs.preload, /preload[\\/]watch\.js$/);
  assert.deepEqual({ ...prefs, preload: 'x' }, { partition: PARTITION, preload: 'x', contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false });
  assert.equal(params.src, 'about:blank', 'starts blank: the stream is loaded once it’s handed over');
  const chat = {};
  assert.equal(w.allowAttach(chat, { src: 'about:blank#chat', partition: PARTITION }), true);
  assert.match(chat.preload, /preload[\\/]chat\.js$/);
  assert.equal(w.allowAttach({}, { src: 'https://example.com/', partition: PARTITION }), false, 'another page');
  assert.equal(w.allowAttach({}, { src: 'about:blank#player', partition: 'persist:other' }), false, 'another session');
  assert.equal(w.allowAttach({}, undefined), false);
  const full = setupWatcher({ playerMode: 'full' });
  full.w.ensureViews();
  assert.equal(full.w.allowAttach({}, { src: 'about:blank#chat', partition: PARTITION }), false, 'no chat in full mode');
});

test('a <webview> handed over is taken only if it’s the main window’s own, of the current spec; then the stream loads in it', () => {
  const { w, host, all } = setupWatcher();
  w.ensureViews();
  const player = fakeContents(5, { host });
  const chat = fakeContents(6, { host });
  const stranger = fakeContents(7, { host: fakeContents(99, { type: 'window' }) });
  for (const c of [player, chat, stranger]) all.set(c.id, c);
  assert.equal(w.attach('player', 1, 1), false, 'the window itself');
  assert.equal(w.attach('player', 1, 7), false, 'another window’s webview');
  assert.equal(w.attach('player', 0, 5), false, 'an old spec');
  assert.equal(w.attach('nope', 1, 5), false);
  assert.equal(w.attach('player', 1, 404), false, 'gone');
  w.watch('arcadia');
  assert.equal(w.view, null, 'not handed over yet: nothing to load');
  assert.equal(w.attach('player', 1, 5), true);
  assert.equal(w.view.webContents, player);
  assert.deepEqual(player.loaded, ['https://player.kick.com/arcadia?autoplay=true&muted=false']);
  assert.equal(player.muted, true);
  assert.equal(w.attach('player', 1, 5), true, 'again: no harm');
  assert.equal(player.loaded.length, 1);
  assert.equal(w.attach('chat', 1, 6), true);
  assert.deepEqual(chat.loaded, ['https://kick.com/popout/arcadia/chat']);
  player.emit('destroyed');
  assert.equal(w.view, null, 'closed with the page');
});

test('the player’s reports count only from its own page: the chat’s only for Kick’s realtime events', () => {
  const { w, host, all, ipc } = setupWatcher();
  w.ensureViews();
  const player = fakeContents(5, { host });
  const chat = fakeContents(6, { host });
  all.set(5, player).set(6, chat);
  w.attach('player', 1, 5);
  w.attach('chat', 1, 6);
  w.watch('arcadia');
  const events = [];
  w.on('watch-event', (e) => events.push(e.channelId));
  w.on('gamification', (e) => events.push(e.event));
  ipc.handlers['watch:event']({ sender: player }, { kind: 'watch-event', channelId: 7 });
  ipc.handlers['watch:event']({ sender: chat }, { kind: 'watch-event', channelId: 8 });
  ipc.handlers['watch:event']({ sender: chat }, { kind: 'realtime', event: 'App\\Events\\GamificationWatchTimeGoalReached' });
  ipc.handlers['watch:event']({ sender: fakeContents(9) }, { kind: 'watch-event', channelId: 9 });
  assert.deepEqual(events, [7, 'GamificationWatchTimeGoalReached']);
  const q = { sender: player };
  ipc.handlers['watch:quality'](q);
  assert.equal(q.returnValue, null);
});
