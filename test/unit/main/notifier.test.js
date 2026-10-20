const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Notifier, KINDS, DEFAULT_NOTIFY, cleanNotify, systemSettingsUrl, REPEAT_MS } = require('../../../src/main/notifier');

/** Electron's Notification, recording what was shown; `answer` is the event the system replies with. */
function fakeNotification({ supported = true, answer = 'show' } = {}) {
  const shown = [];
  class N extends EventEmitter {
    constructor(opts) {
      super();
      this.opts = opts;
    }
    show() {
      shown.push(this.opts);
      if (answer) setImmediate(() => this.emit(answer));
    }
  }
  N.isSupported = () => supported;
  return { N, shown };
}

function setup({ notify = {}, notifyAway = false, inFront = false, ...fake } = {}) {
  const { N, shown } = fakeNotification(fake);
  let t = 1_000_000;
  const clicks = [];
  const settings = { notify: { ...DEFAULT_NOTIFY, ...notify }, notifyAway };
  const notifier = new Notifier({ Notification: N, getSettings: () => settings, inFront: () => inFront, onClick: (view) => clicks.push(view), now: () => t });
  return { notifier, shown, clicks, settings, advance: (ms) => (t += ms) };
}

test('every kind is off to start with, and a kind that is off shows nothing', () => {
  assert.deepEqual(KINDS, ['claimed', 'ready', 'ended', 'trouble', 'conflict', 'signedOut', 'done', 'newDrops', 'dailyReady', 'dailyClaimed']);
  assert.ok(Object.values(DEFAULT_NOTIFY).every((on) => on === false));
  const { notifier, shown } = setup();
  for (const kind of KINDS) assert.equal(notifier.send(kind, { title: 'x' }), 'off');
  assert.equal(shown.length, 0);
});

test('a kind that is on shows, silently, and a click brings the app forward on its view', () => {
  const { notifier, shown, clicks } = setup({ notify: { ended: true } });
  assert.equal(notifier.send('ended', { title: 'Stream ended', body: 'Arcadia ended the stream', view: 'history' }), 'shown');
  assert.equal(shown.length, 1);
  assert.equal(shown[0].title, 'Stream ended');
  assert.equal(shown[0].silent, true, "the app's own alert sound is separate");
  notifier.live[0].emit('click');
  assert.deepEqual(clicks, ['history']);
  notifier.live[0].emit('close');
  assert.equal(notifier.live.length, 0, 'a closed one is let go');
});

test('the same notification twice in ten minutes shows once; a different one still shows', () => {
  const { notifier, shown, advance } = setup({ notify: { trouble: true } });
  assert.equal(notifier.send('trouble', { title: 'Stream problem', body: 'Reloaded Arcadia' }), 'shown');
  assert.equal(notifier.send('trouble', { title: 'Stream problem', body: 'Reloaded Arcadia' }), 'repeat');
  assert.equal(notifier.send('trouble', { title: 'Stream problem', body: 'Reloaded EmberFox' }), 'shown');
  advance(REPEAT_MS);
  assert.equal(notifier.send('trouble', { title: 'Stream problem', body: 'Reloaded Arcadia' }), 'shown');
  assert.equal(shown.length, 3);
});

test('"Only when Pear Drops isn’t in front" skips them while the app has focus', () => {
  assert.equal(setup({ notify: { claimed: true }, notifyAway: true, inFront: true }).notifier.send('claimed', { title: 'Drop claimed' }), 'in-front');
  assert.equal(setup({ notify: { claimed: true }, notifyAway: true, inFront: false }).notifier.send('claimed', { title: 'Drop claimed' }), 'shown');
  assert.equal(setup({ notify: { claimed: true }, notifyAway: false, inFront: true }).notifier.send('claimed', { title: 'Drop claimed' }), 'shown');
});

test('a computer without notifications, and the notifications kept for their clicks are capped', () => {
  assert.equal(setup({ notify: { claimed: true }, supported: false }).notifier.send('claimed', { title: 'x' }), 'unsupported');
  const { notifier } = setup({ notify: { claimed: true } });
  for (let i = 0; i < 40; i++) notifier.send('claimed', { title: `Drop ${i}` });
  assert.equal(notifier.live.length, 30);
});

test('Send a test: shown, blocked, or no answer (macOS never says)', async (t) => {
  assert.equal(await setup({ answer: 'show' }).notifier.test(), 'shown', 'whatever is switched on');
  assert.equal(await setup({ answer: 'failed' }).notifier.test(), 'failed');
  assert.equal(await setup({ supported: false }).notifier.test(), 'unsupported');
  const quiet = setup({ answer: null });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const p = quiet.notifier.test();
  t.mock.timers.tick(3000);
  assert.equal(await p, 'sent');
  quiet.notifier.live[0].emit('click');
  assert.deepEqual(quiet.clicks, [null], 'a click on the test just brings the app forward');
});

test('demo mode and tests record notifications instead of showing them', async () => {
  const notes = [];
  const notifier = new Notifier({ Notification: null, getSettings: () => ({ notify: { claimed: true } }), record: (n) => notes.push(n) });
  assert.equal(notifier.send('claimed', { title: 'Drop claimed', body: 'Hype Rocket' }), 'shown');
  assert.equal(await notifier.test(), 'sent');
  assert.deepEqual(
    notes.map((n) => [n.kind, n.title]),
    [
      ['claimed', 'Drop claimed'],
      ['test', 'Pear Drops'],
    ],
  );
});

test('saved switches are cleaned: unknown kinds dropped, anything but true is off', () => {
  assert.deepEqual(cleanNotify({ claimed: true, ended: 'yes', bogus: true }), { ...DEFAULT_NOTIFY, claimed: true });
  assert.deepEqual(cleanNotify(null), DEFAULT_NOTIFY);
  assert.deepEqual(cleanNotify('on'), DEFAULT_NOTIFY);
});

test('the system notification settings open on macOS and Windows', () => {
  assert.match(systemSettingsUrl('darwin'), /^x-apple\.systempreferences:/);
  assert.equal(systemSettingsUrl('win32'), 'ms-settings:notifications');
  assert.equal(systemSettingsUrl('linux'), null);
});
