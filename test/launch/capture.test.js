// Capture mode (the trailer and screenshots): the stream panel's pages render offscreen and
// are drawn into the window, laid out like the docked views so recordings show them.
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchApp, until } = require('./app');

let a;
test.before(async () => {
  a = await launchApp({ mirror: true, size: { width: 1512, height: 944 } });
  await a.farming();
});
test.after(async () => {
  assert.deepEqual(a.errors, []);
  await a.close();
});

test('Light mode shows the mirrored player at 16:9 with its chat below, filling the panel', async () => {
  await until(a.win, () => ['#player-mirror', '#chat-mirror'].every((s) => { const el = document.querySelector(s); return el && !el.hidden && el.complete && el.naturalWidth; }), 'both mirrored pages', 30000);
  const box = await a.win.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    const [slot, player, chat] = ['#player-slot', '#player-mirror', '#chat-mirror'].map(r);
    return { slot: [slot.top, slot.width, slot.bottom], player: [player.top, player.width, player.height], chat: [chat.top, chat.bottom] };
  });
  assert.equal(box.player[0], box.slot[0], 'the player at the top');
  assert.ok(Math.abs(box.player[2] - (box.player[1] * 9) / 16) < 1, `the player at 16:9 (${box.player[1]}×${box.player[2]})`);
  assert.ok(Math.abs(box.chat[0] - (box.player[0] + box.player[2])) < 1, 'the chat right under it');
  assert.ok(Math.abs(box.chat[1] - box.slot[2]) < 1, 'the chat down to the bottom of the panel');
});
