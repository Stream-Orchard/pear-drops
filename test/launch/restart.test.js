// Quitting and opening the app again soon after: the run carries on rather than starting from zero.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launchApp, until } = require('./app');
const { FILE } = require('../../src/main/db');

const stats = (a) => a.app.evaluate(() => {
  const { farmer } = global.pdDebug;
  return { ...farmer.stats, slug: farmer.current?.slug, startedWatchingAt: farmer.current?.startedWatchingAt };
});

test('a quick restart keeps the stat cards counting and the stream it was watching', async () => {
  const first = await launchApp({ seed: false, eventSeconds: 2 });
  await first.farming();
  await first.app.evaluate(async () => {
    const { farmer } = global.pdDebug;
    for (let i = 0; i < 60 && !farmer.stats.eventsSent; i++) await new Promise((r) => setTimeout(r, 250));
  });
  const before = await stats(first);
  assert.ok(before.eventsSent > 0 && before.slug, 'watching, with a watch event sent');
  await first.app.close(); // quits the app, which saves the run
  // The database (closed as the app quit, so it's all in the one file) and the settings.
  const files = Object.fromEntries([FILE, 'settings.json'].map((f) => [f, fs.readFileSync(path.join(first.data, f))]));
  assert.ok(!fs.existsSync(path.join(first.data, `${FILE}-wal`)), 'nothing left only in the write-ahead log');
  fs.rmSync(first.data, { recursive: true, force: true });

  const second = await launchApp({ seed: false, eventSeconds: 600, files });
  try {
    await second.farming();
    const after = await stats(second);
    assert.equal(after.sessionStart, before.sessionStart, 'the same run');
    assert.ok(after.eventsSent >= before.eventsSent, 'watch events go on from where they were');
    assert.ok(after.watchMs >= before.watchMs, 'and so does the watch time');
    assert.equal(after.slug, before.slug);
    assert.equal(after.startedWatchingAt, before.startedWatchingAt, 'watched since before the restart');
    // In the page's own clock format, which can differ from this process's locale.
    await until(second.win, (t) => document.querySelector('#stats')?.textContent.includes(`since ${fmtClock(t)}`), 'the Watch time card from the first start', 10000, before.sessionStart);
    assert.deepEqual(second.errors, []);
  } finally {
    await second.close();
  }
});
