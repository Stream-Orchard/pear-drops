// Settings › Privacy & data: backing the data up, and a damaged data file put back from a backup.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launchApp, until, readDb } = require('./app');
const { FILE, BACKUPS, listBackups } = require('../../src/main/db');

test('Back up now makes a copy, and a damaged data file is replaced by it at the next start', async () => {
  const first = await launchApp({ seed: false });
  let backup;
  let settings;
  try {
    await first.farming();
    await first.win.click('button.icon-only[data-action="settings"]');
    await first.win.click('[data-action="settings-tab"][data-id="privacy"]');
    await until(first.win, () => /None yet/.test(document.querySelector('.pane-privacy')?.textContent), 'no backup yet');
    await first.win.click('[data-action="setting-value"][data-key="backupKeep"][data-id="7"]');
    await until(first.win, () => document.querySelector('[data-key="backupKeep"][data-id="7"].active'), 'keep 7 chosen');
    await first.win.click('[data-action="backup-now"]');
    await until(first.win, () => /Last one today at .*1 copy/.test(document.querySelector('.pane-privacy')?.textContent), 'the backup shown');
    [backup] = listBackups(path.join(first.data, BACKUPS));
    assert.ok(backup && !backup.before, 'a copy in the backups folder');
    await first.win.click('[data-action="backup-show"]');
    assert.deepEqual(await first.app.evaluate(() => global.pdOpened), [path.join(first.data, BACKUPS)], 'Show opens the backups folder');
    assert.deepEqual(first.errors, []);
    await first.app.close();
    settings = JSON.parse(fs.readFileSync(path.join(first.data, 'settings.json'), 'utf8'));
    assert.equal(settings.backupKeep, 7);
    backup.buffer = fs.readFileSync(backup.file);
  } finally {
    await first.close();
  }

  const second = await launchApp({ seed: false, settings, files: { [FILE]: 'damaged: not a database any more', [`${BACKUPS}/${backup.name}`]: backup.buffer } });
  try {
    await second.farming();
    const events = () => readDb(second.data, (db) => db.events().map((r) => r.e));
    const restored = events().find((e) => e.type === 'data-restored');
    assert.equal(restored?.backup, backup.name, 'History says which backup was put back');
    assert.ok(events().filter((e) => e.type === 'start').length >= 2, 'the first start’s history came back with it');
    assert.ok(fs.readdirSync(second.data).some((f) => f.startsWith(`${FILE}.broken-`)), 'the damaged file is kept aside');
    await second.win.click('[data-action="view"][data-id="history"]');
    await until(second.win, () => /Data restored/.test(document.querySelector('.htable')?.textContent), 'Data restored in the timeline');
    assert.deepEqual(second.errors, []);
  } finally {
    await second.close();
  }
});
