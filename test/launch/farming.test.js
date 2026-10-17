const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launchApp, until } = require('./app');

let a;
test.before(async () => {
  a = await launchApp({ size: { width: 1512, height: 944 } });
  await until(a.win, () => document.querySelector('#hero .hero-title'), 'farming to start', 20000);
});
test.after(async () => {
  assert.deepEqual(a.errors, []);
  await a.close();
});

const heroUnits = () => a.win.evaluate(() => document.querySelector('.ring-sub')?.textContent);

test('farms the highest-priority drop on the stand-in stream, with every panel filled', async () => {
  assert.match(await a.win.textContent('.hero-title'), /Neon Rush Launch Week/);
  assert.match(await a.win.textContent('.hero-stream .name'), /Arcadia/);
  assert.equal(await a.win.locator('#stats .stat').count(), 6);
  assert.ok(await a.win.locator('#chart svg.progress-chart').count());
  assert.ok((await a.win.locator('.cat[data-cat-id]').count()) >= 4);
  const scroll = await a.win.evaluate(() => { const c = document.querySelector('#content'); return c.scrollHeight - c.clientHeight; });
  assert.ok(scroll <= 2, `the dashboard fits without scrolling (${scroll}px over)`);
});

test('panels stay still while the dashboard ticks: no layout shifts, images kept', async () => {
  const snap = () =>
    a.win.evaluate(() => {
      document.querySelectorAll('img').forEach((img) => (img.__kept ??= true));
      return {
        rects: ['#hero', '#stats', '#chart', '#side', '.hero-stream', '.hero-side', '.titlebar-actions .tb-btn', '.nav-item.active', '.hero-stall .stall-track'].map((sel) => {
          const r = document.querySelector(sel)?.getBoundingClientRect();
          return r ? [sel, Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(':') : sel;
        }),
        kept: [...document.querySelectorAll('img')].filter((img) => img.__kept).length,
        total: document.querySelectorAll('img').length,
      };
    });
  // The panels rise into place when the page opens: measure once that has finished (a slow
  // machine can still be running it). Spinners and pulses repeat forever, so they're left out.
  await a.win.evaluate(() => Promise.all(document.getAnimations().filter((an) => an.effect?.getTiming().iterations !== Infinity).map((an) => an.finished.catch(() => {}))));
  const first = await snap();
  await a.win.waitForTimeout(4500);
  const later = await snap();
  assert.deepEqual(later.rects, first.rects);
  assert.equal(later.kept, later.total, 'no image was rebuilt');
});

test('a watch event from the player is credited and shows up everywhere', async () => {
  const before = await heroUnits();
  await a.demo((d) => d.credit());
  await until(a.win, (b) => document.querySelector('.ring-sub')?.textContent !== b, 'the ring to move', 10000, before);
  assert.notEqual(await heroUnits(), before);
  await a.win.click('[data-action="side-tab"][data-id="activity"]');
  await until(a.win, () => /\+2 min on Neon Rush/.test(document.querySelector('.log')?.textContent), 'the credit in the activity log');
});

test('watch events without credit raise the conflict banner; a repeating alarm can be stopped', async () => {
  await a.win.evaluate(() => window.pd.setSettings({ repeatAlert: true }));
  await a.demo((d) => d.conflict(true));
  for (let i = 0; i < 3; i++) await a.demo((d) => d.credit());
  await until(a.win, () => document.querySelector('#banner .banner'), 'the conflict banner', 10000);
  assert.match(await a.win.textContent('#banner'), /taking your drop credit/);
  assert.match(await a.win.textContent('#banner'), /close any other streams to continue progressing drops/);
  await until(a.win, () => document.querySelector('#banner [data-action="stop-alarm"]'), 'Stop alarm while it repeats');
  await a.win.click('#banner [data-action="stop-alarm"]');
  await until(a.win, () => !document.querySelector('#banner [data-action="stop-alarm"]'), 'the button to go once stopped');
  await a.win.evaluate(() => window.pd.setSettings({ repeatAlert: false }));
  await a.demo((d) => d.conflict(false));
  await a.demo((d) => d.credit());
  await until(a.win, () => !document.querySelector('#banner .banner'), 'the banner to clear once credit returns', 10000);
});

test('when the stream goes offline it moves to the next eligible stream', async () => {
  await a.demo((d, slug) => d.offline(slug), 'arcadia');
  await until(a.win, () => !/Arcadia/.test(document.querySelector('.hero-stream .name')?.textContent ?? 'Arcadia'), 'a new stream', 15000);
  const name = await a.win.textContent('.hero-stream .name');
  assert.ok(/EmberFox|PixelPear/.test(name), name);
});

test('dragging a category to the top reorders the queue and is remembered', async () => {
  await a.win.click('[data-action="side-tab"][data-id="queue"]');
  const rows = a.win.locator('.cat[data-cat-id]:not(.drag-ghost)');
  const last = await rows.nth(3).getAttribute('data-cat-id');
  // Carried over step by step, as a person (or the trailer) drags: the row lifts as a
  // card the page draws itself, so it shows in screenshots and recordings.
  const from = await rows.nth(3).boundingBox();
  const to = await rows.nth(0).boundingBox();
  const opened = () => a.win.locator('.cat .cat-campaigns').count();
  const openBefore = await opened();
  // A short drag let go over its own row changes nothing, and doesn't count as a click that opens it.
  await a.win.mouse.move(from.x + 12, from.y + 20);
  await a.win.mouse.down();
  await a.win.mouse.move(from.x + 12, from.y + 40, { steps: 4 });
  await a.win.mouse.up();
  await until(a.win, () => !document.querySelector('.drag-ghost'), 'the short drag to end');
  assert.equal(await opened(), openBefore, 'letting go of a drag doesn’t also open the row');
  await a.win.mouse.move(from.x + 12, from.y + 20);
  await a.win.mouse.down();
  await a.win.mouse.move(from.x + 12, from.y + 14, { steps: 2 });
  await a.win.mouse.move(to.x + 20, to.y + 8, { steps: 12 });
  const lifted = await a.win.evaluate(() => {
    const g = document.querySelector('.cat.drag-ghost');
    return g && { top: g.getBoundingClientRect().top, marker: !!document.querySelector('.cat.drop-before, .cat.drop-after') };
  });
  await a.win.mouse.up();
  assert.ok(lifted, 'the dragged row follows the pointer');
  assert.ok(lifted.top < from.y - 20, `the lifted row moved up (${lifted.top} vs ${from.y})`);
  assert.ok(lifted.marker, 'a drop marker shows where it will land');
  await until(a.win, () => !document.querySelector('.drag-ghost'), 'the lifted row to go once dropped');
  await until(a.win, (id) => document.querySelector('.cat[data-cat-id]')?.dataset.catId === id, 'the new order', 10000, last).catch(() => {});
  assert.equal(await rows.nth(0).getAttribute('data-cat-id'), last);
  const saved = JSON.parse(fs.readFileSync(path.join(a.data, 'settings.json'), 'utf8'));
  assert.equal(String(saved.categoryOrder[0]), last);
});

test('hovering a queue row swaps in the arrows without moving the switch; finished rows have left', async () => {
  await a.win.click('[data-action="side-tab"][data-id="queue"]');
  const row = a.win.locator('.cat[data-cat-id]:not(.locked)').first();
  // Where the switch sits inside its row (hovering may scroll the list itself).
  const place = () => row.evaluate((r) => { const a = r.getBoundingClientRect(); const b = r.querySelector('.switch').getBoundingClientRect(); return [b.left - a.left, b.top - a.top, b.width]; });
  await row.scrollIntoViewIfNeeded();
  const before = await place();
  await row.hover();
  await a.win.waitForTimeout(250);
  assert.deepEqual(await place(), before);
  assert.equal(await row.locator('.cat-arrows').evaluate((el) => getComputedStyle(el).opacity), '1');
  // Finished categories aren't in the queue at all: they're in the Done tab.
  assert.equal(await a.win.locator('.cat.locked').count(), 0);
  assert.equal(await a.win.locator('.cat[data-cat-id]', { hasText: 'Pixel Kart' }).count(), 0);
});

test('the queue can switch to smart order, which locks dragging and is saved', async () => {
  await a.win.click('[data-action="side-tab"][data-id="queue"]');
  await a.win.click('[data-action="queue-mode"][data-id="smart"]');
  await until(a.win, () => document.querySelector('.cat.smart'), 'smart rows');
  assert.equal(await a.win.locator('.cat[data-reorder]').count(), 0);
  const smartRow = a.win.locator('.cat.smart').first();
  await smartRow.hover();
  await a.win.waitForTimeout(300);
  assert.match(await smartRow.locator('.cat-grip').getAttribute('data-tip'), /Switch to Manual/, 'a lock explains why there are no arrows');
  assert.equal(await smartRow.locator('.cat-stats').evaluate((el) => getComputedStyle(el).opacity), '1', 'the time left stays visible');
  const saved = JSON.parse(fs.readFileSync(path.join(a.data, 'settings.json'), 'utf8'));
  assert.equal(saved.queueMode, 'smart');
  await a.win.screenshot({ path: require('node:os').tmpdir() + '/pd-smart-queue.png' });
  // Trying to drag in Smart mode: a nudge pops up, and its button switches to Manual.
  const box = await smartRow.boundingBox();
  await a.win.mouse.move(box.x + 60, box.y + 20);
  await a.win.mouse.down();
  await a.win.mouse.move(box.x + 60, box.y + 80, { steps: 5 });
  await a.win.mouse.up();
  await until(a.win, () => document.querySelector('#nudge.on'), 'the smart-order nudge');
  await a.win.screenshot({ path: require('node:os').tmpdir() + '/pd-nudge.png' });
  await a.win.click('#nudge [data-action="queue-mode"][data-id="manual"]');
  await until(a.win, () => document.querySelector('.cat[data-reorder]'), 'manual rows');
});

test('hovering a reward shows it large: the real emote once you own it, else the artwork', async () => {
  // The queue lists every reward, whichever drop is being farmed.
  await a.win.click('[data-action="side-tab"][data-id="queue"]');
  const row = a.win.locator('.cat[data-cat-id]', { hasText: 'Neon Rush' }).first();
  if (!(await row.locator('.cat-campaigns').count())) await row.locator('.cat-row').click();
  const hoverPreview = async (text) => {
    for (let i = 0; i < 6; i++) {
      // Scrolled to the middle first: the queue's header is sticky.
      await row.locator('.mini-reward', { hasText: text }).evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await row.locator('.mini-reward', { hasText: text }).hover();
      await a.win.waitForTimeout(450);
      const shown = await a.win.evaluate((t) => document.querySelector('.reward-preview.on')?.textContent.includes(t), text);
      if (shown) return a.win.textContent('.reward-preview');
    }
    throw new Error(`no preview for ${text}`);
  };
  const claimed = await hoverPreview('Hype Rocket');
  assert.match(claimed, /Your emote HypeRocket/);
  assert.match(claimed, /Animated/);
  const open = await hoverPreview('Neon Crown');
  assert.match(open, /Reward artwork/);
  assert.match(open, /Badge/);
  // The reward at the end of the bar sits right beside the stream: the preview opens
  // on the side away from it (the page can't draw over the stream).
  const mark = row.locator('.cat-row .track-mark').last();
  await mark.hover();
  await until(a.win, () => document.querySelector('.reward-preview.on'), 'the preview by the stream');
  await a.win.waitForTimeout(100);
  const [cardRight, wall] = await a.win.evaluate(() => [document.querySelector('.reward-preview').getBoundingClientRect().right, document.getElementById('player-slot').getBoundingClientRect().left]);
  assert.ok(cardRight <= wall, `the preview (to ${cardRight}) stays clear of the stream (from ${wall})`);
  await a.win.mouse.move(5, 500);
});

test('icon-only buttons all have tooltips, shown by the app', async () => {
  const missing = await a.win.evaluate(() => [...document.querySelectorAll('button.icon-only')].filter((b) => !b.getAttribute('data-tip')).map((b) => b.outerHTML.slice(0, 80)));
  assert.deepEqual(missing, []);
  await a.win.hover('[data-action="refresh"]');
  await until(a.win, () => document.querySelector('.tooltip.on')?.textContent, 'a tooltip');
  assert.match(await a.win.textContent('.tooltip'), /^Next refresh in \d+s\. Click to refresh now$/);
  await a.win.mouse.move(5, 500);
});

test('settings toggles are saved', async () => {
  await a.win.click('button.icon-only[data-action="settings"]');
  await a.win.click('[data-action="setting-toggle"][data-key="includeGameDrops"]');
  await until(a.win, () => document.querySelector('[data-key="includeGameDrops"]')?.classList.contains('on'), 'the toggle to turn on');
  const saved = JSON.parse(fs.readFileSync(path.join(a.data, 'settings.json'), 'utf8'));
  assert.equal(saved.includeGameDrops, true);
  await a.win.keyboard.press('Escape');
});

test('Settings › App › Font switches between the system font and the bundled Inter, and is saved', async () => {
  const font = () => a.win.evaluate(() => [document.documentElement.dataset.font, getComputedStyle(document.body).fontFamily]);
  const [start] = await font();
  assert.equal(start, process.platform === 'linux' ? 'bundled' : 'system', 'Inter on Linux, the system font elsewhere');
  const other = start === 'bundled' ? 'system' : 'bundled';
  await a.win.click('button.icon-only[data-action="settings"]');
  await a.win.click('[data-action="settings-tab"][data-id="app"]');
  await a.win.click(`[data-key="font"][data-id="${other}"]`);
  await until(a.win, (f) => document.documentElement.dataset.font === f, 'the other font', 10000, other);
  const [, family] = await font();
  assert.equal(family.startsWith('"PD Inter"'), other === 'bundled', family);
  assert.equal(JSON.parse(fs.readFileSync(path.join(a.data, 'settings.json'), 'utf8')).font, other);
  await a.win.click(`[data-key="font"][data-id="${start}"]`);
  await until(a.win, (f) => document.documentElement.dataset.font === f, 'the first font again', 10000, start);
  await a.win.keyboard.press('Escape');
});

test('the tray popover shows the current drop and controls', async () => {
  await a.demo((d) => d.openTray());
  const pop = await until(a.win, () => true, 'tray').then(async () => {
    for (let i = 0; i < 40; i++) {
      const w = a.app.windows().find((x) => x.url().endsWith('tray.html'));
      if (w) return w;
      await a.win.waitForTimeout(150);
    }
    throw new Error('no tray popover');
  });
  await until(pop, () => document.querySelector('.tray-now .ring'), 'the popover content');
  assert.match(await pop.textContent('.tray-foot'), /Pause/);
  await pop.hover('[data-action="quit"]');
  await until(pop, () => document.querySelector('.tooltip.on')?.textContent, 'the quit tooltip');
  assert.equal(await pop.textContent('.tooltip'), 'Quit Pear Drops (stops farming)');
});

test('the player header follows and unfollows the channel', async () => {
  await until(a.win, () => document.querySelector('#player-head .follow-btn'), 'the follow button');
  const slug = await a.win.getAttribute('#player-head .follow-btn', 'data-slug');
  const following = async () => (await a.win.getAttribute('#player-head .follow-btn', 'class')).includes('following');
  const before = await following();
  await a.win.click('#player-head .follow-btn');
  await until(a.win, (b) => document.querySelector('#player-head .follow-btn')?.classList.contains('following') !== b, 'the button to flip', 10000, before);
  assert.equal(await a.demo((d, s) => d.api.follows.has(s), slug), !before, 'the stand-in Kick has the change');
  await a.win.click('#player-head .follow-btn');
  await until(a.win, (b) => document.querySelector('#player-head .follow-btn')?.classList.contains('following') === b, 'the button to flip back', 10000, before);
  await a.win.mouse.move(5, 500);
});
