// Smart order and rarely live drops: the queue's Rare chip, its order, and the Smart settings.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launchApp, until } = require('./app');

const JUST_CHATTING = 802; // a stand-in category, ending in 3 days
let a;
test.before(async () => {
  a = await launchApp({ size: { width: 1512, height: 944 } });
  await a.farming();
  // A week of looks: Just Chatting had a stream on one hour in ten, the others always.
  await a.app.evaluate((_e, rare) => {
    const { farmer } = global.pdDebug;
    const hour = 3600_000;
    for (const cat of farmer.model.categories) {
      for (let h = 1; h <= 40; h++) farmer.availability.note(cat.id, Date.now() - h * hour, cat.id !== rare || h % 10 === 0);
    }
    farmer.buildModel();
    farmer.changed();
  }, JUST_CHATTING);
});
test.after(async () => {
  assert.deepEqual(a.errors, []);
  await a.close();
});

const settings = () => JSON.parse(fs.readFileSync(path.join(a.data, 'settings.json'), 'utf8'));

test('a rarely live category shows a Rare chip with how many of the hours seen it was live', async () => {
  await a.win.click('[data-action="side-tab"][data-id="queue"]');
  const chip = `.cat[data-cat-id="${JUST_CHATTING}"] .chip.violet`;
  await until(a.win, (s) => document.querySelector(s), 'the Rare chip', 10000, chip);
  assert.equal((await a.win.textContent(chip)).trim(), 'Rare');
  assert.match(await a.win.getAttribute(chip, 'data-tip'), /^Live \d+ of \d+ hours seen since \w+ \d.+\.\nSmart order would watch it/);
  assert.equal(await a.win.locator('.cat .chip.violet').count(), 1, 'only the rare one');
});

test('Settings › Farming: Smart shows its weighting, which is saved, and the rare drop moves up', async () => {
  await a.win.click('button.icon-only[data-action="settings"]');
  await a.win.click('[data-action="settings-tab"][data-id="farming"]');
  assert.equal(await a.win.locator('[data-key="smartRarity"]').count(), 0, 'hidden in Manual order');
  await a.win.click('.settings-pane [data-action="queue-mode"][data-id="smart"]');
  await until(a.win, () => document.querySelector('[data-key="smartRarity"][data-id="strong"].active'), 'the Smart rows, Strong by default');
  assert.ok(await a.win.locator('[data-key="smartHopMinutes"][data-id="30"].active').count(), '30 min by default');
  await a.win.click('[data-key="smartHopMinutes"][data-id="60"]');
  await until(a.win, () => document.querySelector('[data-key="smartHopMinutes"][data-id="60"].active'), 'the new switch margin');
  assert.equal(settings().smartHopMinutes, 60);
  await a.win.keyboard.press('Escape');
  await until(a.win, (id) => document.querySelector('.cat[data-cat-id]')?.dataset.catId === String(id), 'the rare drop at the top', 15000, JUST_CHATTING);
  assert.match(await a.win.getAttribute(`.cat[data-cat-id="${JUST_CHATTING}"] .chip.violet`, 'data-tip'), /Smart order watches it while it’s on/);

  // Off: sorted by end time alone again, so the rare drop (ending in 3 days) drops back.
  await a.win.click('button.icon-only[data-action="settings"]');
  await a.win.click('[data-key="smartRarity"][data-id="off"]');
  await until(a.win, () => document.querySelector('[data-key="smartRarity"][data-id="off"].active'), 'Off');
  assert.equal(settings().smartRarity, 'off');
  await a.win.keyboard.press('Escape');
  await until(a.win, (id) => document.querySelector('.cat[data-cat-id]')?.dataset.catId !== String(id), 'the rare drop to drop back', 15000, JUST_CHATTING);
});
