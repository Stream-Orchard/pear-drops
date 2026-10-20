const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launchApp, until, readDb } = require('./app');

let a;
test.before(async () => {
  a = await launchApp({ size: { width: 1512, height: 944 } });
  await a.farming();
});
test.after(async () => {
  assert.deepEqual(a.errors, []);
  await a.close();
});

const pastNames = () => a.win.evaluate(() => [...document.querySelectorAll('.past')].map((p) => [p.querySelector('.cat-name span').textContent, p.className.includes('completed') ? 'completed' : 'missed']));
const historyTypes = () => readDb(a.data, (db) => db.events().map((r) => r.e));

test('the Done tab lists finished and missed drops, with stored images', async () => {
  await a.win.click('[data-action="side-tab"][data-id="done"]');
  await until(a.win, () => document.querySelectorAll('.past').length >= 4, 'the past drops');
  const names = Object.fromEntries(await pastNames());
  assert.equal(names[Object.keys(names).find((n) => /Kart/.test(n))], 'completed', 'a finished drop still on Kick');
  assert.equal(names['Frostbite Rally Weekend'], 'completed');
  assert.equal(names['Retro Arcade Week'], 'missed');
  assert.equal(names['Meltdown Mini-Event'], 'missed');
  assert.match(await a.win.locator('.past', { hasText: 'Retro Arcade Week' }).textContent(), /1\/3 claimed/);
  assert.match(await a.win.locator('.past', { hasText: 'Meltdown' }).textContent(), /Taken down/);

  // Images come from the app's own copies and actually load.
  await until(a.win, () => [...document.querySelectorAll('.past img')].every((i) => i.src.startsWith('pd-img://drop/') && i.complete && i.naturalWidth > 0), 'stored images to load');
  const files = fs.readdirSync(path.join(a.data, 'drop-images'));
  assert.ok(files.length >= 10, `${files.length} images stored`);

  // History and Details stacked on the right of the card's top row, not wrapped under the art.
  const rows = await a.win.evaluate(() =>
    [...document.querySelectorAll('.past')]
      .filter((p) => p.querySelector('.details-btn, [data-action="open-link"]'))
      .map((p) => {
        const top = (el) => Math.round(el.getBoundingClientRect().top);
        const row = p.querySelector('.past-row').getBoundingClientRect();
        const left = (el) => Math.round(el.getBoundingClientRect().left);
        const name = p.querySelector('.cat-name span');
        return { history: left(p.querySelector('.hist-btn')), details: left(p.querySelector('.past-actions > :last-child')), rowBottom: Math.round(row.bottom), artBottom: Math.round(p.querySelector('.cat-art').getBoundingClientRect().bottom), nameCut: name.scrollWidth > name.clientWidth + 1 };
      }),
  );
  assert.ok(rows.length, 'some done drops have a Details button');
  for (const r of rows) {
    assert.equal(r.details, r.history, 'Details under History, in the same column');
    assert.ok(r.rowBottom - r.artBottom < 30, 'no extra row under the art');
    assert.equal(r.nameCut, false, 'the name has room');
  }

  // Artwork that's missing (a drop known only from history) shows the placeholder's faint picture,
  // not the art box's plain background.
  const placeholder = await a.win.evaluate(() => {
    const box = document.createElement('div');
    box.className = 'past';
    box.innerHTML = img(null, 'cat-art');
    document.querySelector('#side').appendChild(box);
    const bg = getComputedStyle(box.firstElementChild).backgroundImage;
    box.remove();
    return bg;
  });
  assert.match(placeholder, /data:image\/svg\+xml/);

  // Filters
  await a.win.click('[data-action="past-filter"][data-id="missed"]');
  await until(a.win, () => [...document.querySelectorAll('.past')].every((p) => p.classList.contains('missed')), 'only missed drops');
  await a.win.click('[data-action="past-filter"][data-id="all"]');
});

test('a drop Kick stops listing moves to Done, and comes back to the queue if Kick relists it', async () => {
  await a.demo((d) => d.endDrop('c-cozy'));
  await a.win.click('[data-action="side-tab"][data-id="done"]');
  await until(a.win, () => [...document.querySelectorAll('.past.missed')].some((p) => /Cozy/.test(p.textContent)), 'the ended drop in Done');
  assert.match(await a.win.locator('.past', { hasText: 'Cozy' }).textContent(), /1\/2 claimed/);
  await a.win.click('[data-action="side-tab"][data-id="queue"]');
  // Cozy Hours (limited to its event's channels) had a row of its own; Just Chatting keeps its open drop.
  assert.equal(await a.win.locator('.cat[data-cat-id]', { hasText: 'Cozy Hours' }).count(), 0);
  assert.equal(await a.win.locator('.cat[data-cat-id]', { hasText: 'Just Chatting' }).count(), 1);

  await a.demo((d) => d.relistDrop('c-cozy', 2));
  await until(a.win, () => [...document.querySelectorAll('.cat[data-cat-id]')].some((r) => /Cozy Hours/.test(r.textContent)), 'the drop back in the queue');
  await a.win.click('[data-action="side-tab"][data-id="done"]');
  assert.equal(await a.win.locator('.past', { hasText: 'Cozy' }).count(), 0);

  const events = historyTypes().filter((e) => e.campaignId === 'c-cozy');
  assert.ok(events.some((e) => e.type === 'campaign-ended' && /missed 1 of 2/.test(e.text)), 'the end is recorded');
  assert.ok(events.some((e) => e.type === 'campaign-back'), 'the return is recorded');
});

test('History keeps a removed drop’s details and artwork', async () => {
  await a.win.click('[data-action="side-tab"][data-id="done"]');
  await a.win.locator('.past', { hasText: 'Retro Arcade Week' }).locator('[data-action="hist-campaign"]').click();
  await until(a.win, () => /Retro Arcade Week/.test(document.querySelector('.hist-title h2')?.textContent), 'the drop’s history');
  const art = await a.win.locator('.hist-title img').getAttribute('src');
  assert.match(art, /^pd-img:\/\/drop\//);
  assert.match(await a.win.textContent('.hist-title'), /Retro Arcade/);
});
