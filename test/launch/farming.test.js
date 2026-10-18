const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launchApp, until } = require('./app');

let a;
test.before(async () => {
  a = await launchApp({ size: { width: 1512, height: 944 } });
  await a.farming();
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
  await until(a.win, () => /\+\d+ min on Neon Rush/.test(document.querySelector('.log')?.textContent), 'the credit in the activity log');
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

test('Settings › Notifications: all off to start with; switches are saved, a test is sent, and a stream ending notifies once switched on', async () => {
  const saved = () => JSON.parse(fs.readFileSync(path.join(a.data, 'settings.json'), 'utf8'));
  await a.win.click('button.icon-only[data-action="settings"]');
  await a.win.click('[data-action="settings-tab"][data-id="notifications"]');
  const switches = await a.win.$$eval('[data-action="notify-toggle"]', (els) => els.map((e) => [e.dataset.kind, e.classList.contains('on')]));
  assert.equal(switches.length, 8);
  assert.ok(switches.every(([, on]) => !on), 'all off to start with');

  await a.win.click('[data-action="notify-test"]');
  await until(a.win, () => /^Sent\./.test(document.querySelector('.notify-result')?.textContent ?? ''), 'the test result', 10000);
  const notes = () => a.app.evaluate(() => global.pdNotes);
  assert.deepEqual((await notes()).map((n) => n.title), ['Pear Drops'], 'sent (recorded, in tests) whatever is switched on');

  await a.win.click('[data-action="notify-toggle"][data-kind="ended"]');
  await until(a.win, () => document.querySelector('[data-action="notify-toggle"][data-kind="ended"]')?.classList.contains('on'), 'the switch', 10000);
  assert.equal(saved().notify.ended, true);
  assert.equal(saved().notify.claimed, false);
  await a.win.click('[data-action="setting-toggle"][data-key="notifyAway"]');
  await until(a.win, () => document.querySelector('[data-key="notifyAway"]')?.classList.contains('on'), 'only when away', 10000);
  assert.equal(saved().notifyAway, true);
  await a.win.click('[data-action="setting-toggle"][data-key="notifyAway"]');
  await until(a.win, () => !document.querySelector('[data-key="notifyAway"]')?.classList.contains('on'), 'always', 10000);
  await a.win.keyboard.press('Escape');

  await a.app.evaluate(() => {
    global.pdDebug.farmer.lastQuickCheckAt = 0;
    global.pdDebug.farmer.blacklist.clear();
    global.pdDemo.api.offline.clear();
  });
  const slug = await a.app.evaluate(() => global.pdDemo.endStream('video'));
  for (let i = 0; i < 40 && !(await notes()).some((n) => n.kind === 'ended'); i++) await a.win.waitForTimeout(150);
  const ended = (await notes()).find((n) => n.kind === 'ended');
  assert.ok(ended, JSON.stringify(await notes()));
  assert.equal(ended.title, 'Stream ended');
  assert.match(ended.body, /^\w+: stream went offline\. Finding the next one\.$/);
  assert.ok(ended.body.toLowerCase().startsWith(`${slug}:`), ended.body);
  assert.equal(ended.view, 'history', 'a click opens History');
  assert.ok(!(await notes()).some((n) => n.kind === 'trouble'), 'kinds that are off stay quiet');
});

test('every Settings tab fits without scrolling; only the changelog under Updates scrolls, inside itself', async () => {
  await a.win.click('button.icon-only[data-action="settings"]');
  const tabs = await a.win.$$eval('[data-action="settings-tab"]', (els) => els.map((e) => e.dataset.id));
  assert.ok(tabs.length >= 8);
  for (const id of tabs) {
    await a.win.click(`[data-action="settings-tab"][data-id="${id}"]`);
    if (id === 'updates') await until(a.win, () => document.querySelector('.upd-timeline li'), 'the changelog', 10000);
    const [content, box] = await a.win.evaluate(() => {
      const p = document.querySelector('.settings-pane');
      return [p.scrollHeight, p.clientHeight];
    });
    assert.ok(content <= box + 1, `Settings › ${id} needs ${content - box}px of scrolling`);
  }
  const timeline = await a.win.evaluate(() => getComputedStyle(document.querySelector('.pane-updates .upd-timeline')).overflowY);
  assert.equal(timeline, 'auto', 'the changelog scrolls inside itself');
  await a.win.keyboard.press('Escape');
});

test('a stream thumbnail that won’t load shows a placeholder in its place, not a broken image', async () => {
  const live = await a.app.evaluate(() => global.pdDebug.farmer.model.categories.find((c) => c.id === global.pdDebug.farmer.current?.categoryId)?.streams.map((s) => s.slug));
  assert.ok(live?.length >= 2, 'a category with streams');
  await a.app.evaluate(async (_e, slug) => {
    global.pdDemo.api.brokenThumbs.add(slug);
    global.pdDebug.farmer.streams.clear();
    while (global.pdDebug.farmer.ticking) await new Promise((r) => setTimeout(r, 50));
    await global.pdDebug.farmer.tick({ force: true });
  }, live[1]);
  await a.win.click('[data-action="side-tab"][data-id="streams"]');
  await until(a.win, () => document.querySelector('#side .thumb .img-missing'), 'the placeholder', 10000);
  const broken = await a.win.evaluate(() => [...document.querySelectorAll('#side img')].filter((i) => i.complete && i.naturalWidth === 0).length);
  assert.equal(broken, 0, 'no broken-image icons');
  const box = await a.win.evaluate(() => { const r = document.querySelector('#side .thumb .img-missing').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
  assert.deepEqual(box, [80, 45], 'it keeps the thumbnail’s size');
  await a.app.evaluate(() => global.pdDemo.api.brokenThumbs.clear());
  await a.win.click('[data-action="side-tab"][data-id="queue"]');
});

test('polish: the Queue badge counts its categories, watch events read as sent, credits group in Activity, and a click leaves no focus ring', async () => {
  const queued = await a.win.evaluate(() => document.querySelectorAll('#side .queue-list .cat').length);
  await a.win.click('[data-action="side-tab"][data-id="queue"]');
  const badge = await a.win.textContent('[data-action="side-tab"][data-id="queue"] em');
  const rows = await a.win.evaluate(() => document.querySelectorAll('#side .queue-list > *').length);
  assert.equal(Number(badge), rows || queued, `the badge (${badge}) counts the categories listed`);
  assert.match(await a.win.textContent('#side .panel-note'), /rewards? to go/);
  assert.match(await a.win.textContent('#stats'), /\d+\s*sent/, 'watch events sent, not a second count beside it');

  await a.win.click('[data-action="side-tab"][data-id="activity"]');
  const texts = await a.win.$$eval('#side .log-text', (els) => els.map((e) => e.textContent));
  const singles = texts.filter((t) => /^\+\d+ min on .* \(\d+ total\)$/.test(t));
  for (let i = 1; i < texts.length; i++) assert.ok(!(singles.includes(texts[i]) && singles.includes(texts[i - 1]) && texts[i].split(' on ')[1].split(' (')[0] === texts[i - 1].split(' on ')[1].split(' (')[0]), 'a run of credits on one drop is one line');

  // A click leaves no ring; Tab brings rings back.
  const ring = () => a.win.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  await a.win.click('[data-action="side-tab"][data-id="streams"]');
  assert.equal(await ring(), 'none', 'no ring after a click');
  await a.win.keyboard.press('Tab');
  assert.notEqual(await ring(), 'none', 'the keyboard shows where focus is');
  await a.win.mouse.click(5, 500);
  await a.win.click('[data-action="side-tab"][data-id="queue"]');
});

test('the Queue ends with Coming soon: the drops Kick has announced, soonest first, one at a time, the next every 30 s or by its dots', async () => {
  await a.win.click('[data-action="side-tab"][data-id="queue"]');
  await until(a.win, () => document.querySelector('#side .coming'), 'Coming soon', 10000);
  const shown = () => a.win.evaluate(() => document.querySelector('#side .coming-info b').textContent);
  assert.equal(await shown(), 'Pixel Kart Night Cup', 'the soonest first');
  assert.match(await a.win.textContent('#side .coming'), /Pixel Kart · starts .+ · in \d+h/);
  assert.equal(await a.win.locator('#side .coming .mini-reward').count(), 2);
  assert.equal(await a.win.locator('#side .coming-dot').count(), 2);
  // On its own after 30 seconds…
  await a.win.evaluate(() => { ui.comingHover = false; ui.comingAt -= 31_000; render(); });
  await until(a.win, () => document.querySelector('#side .coming-info b')?.textContent === 'Skyforge Season 4', 'the next one', 5000);
  // …and straight away from its dots.
  await a.win.click('#side .coming-dot >> nth=0');
  await until(a.win, () => document.querySelector('#side .coming-info b')?.textContent === 'Pixel Kart Night Cup', 'the picked one', 5000);
  // Not while the pointer is on it.
  await a.win.hover('#side .coming');
  await a.win.evaluate(() => { ui.comingAt -= 31_000; render(); });
  await a.win.waitForTimeout(300);
  assert.equal(await shown(), 'Pixel Kart Night Cup', 'stays put under the pointer');
  await a.win.mouse.move(5, 500);
  assert.ok(!(await a.win.textContent('#side .queue-list')).includes('Night Cup'), 'announced drops are not in the queue itself');
});

test("Details opens a drop's About page, and a refused claim says why with a button to link the account", async () => {
  // Coming soon's Details: recorded, not opened (demo mode never opens the real browser).
  await a.win.click('[data-action="side-tab"][data-id="queue"]');
  await until(a.win, () => document.querySelector('#side .coming [data-action="open-link"]'), 'Details on Coming soon', 10000);
  const link = await a.win.getAttribute('#side .coming [data-action="open-link"]', 'data-url');
  assert.match(link, /^https:\/\/kick\.com\/(events|category)\//, "the shown drop's About page");
  await a.win.click('#side .coming [data-action="open-link"]');
  await until(a.win, () => true, 'the click');
  const opened = await a.app.evaluate(() => global.pdOpened);
  assert.ok(opened.includes(link), JSON.stringify(opened));
  assert.match(await a.win.textContent("#side .coming"), /announced (just now|\d+ (min|hours?|days?) ago)/);

  // Kick refuses the next claim, saying the game account must be linked.
  await a.app.evaluate(() => (global.pdDemo.api.refuseClaims = { data: { type: 'INVALID_CLAIM', connect_url: 'https://kick.com/settings/connections' } }));
  const cat = await a.app.evaluate(() => global.pdDebug.farmer.model.campaigns.find((c) => c.id === 'c-neon').categoryId);
  await a.demo((d) => d.advance('c-neon', 180));
  await until(a.win, (id) => document.querySelector(`#side .cat[data-cat-id="${id}"]`), 'the Neon Rush row', 10000, cat);
  // Open its drops (unless an earlier test left them open).
  const open = () => a.win.evaluate((id) => !!document.querySelector(`#side .cat[data-cat-id="${id}"] .cat-campaigns`), cat);
  if (!(await open())) await a.win.click(`#side .cat[data-cat-id="${cat}"] .cat-row`);
  await until(a.win, () => document.querySelector('#side .claim-error + [data-action="open-link"]'), 'Link your account', 10000);
  await a.win.click('#side .claim-error + [data-action="open-link"]');
  await until(a.win, () => true, 'the click');
  assert.ok((await a.app.evaluate(() => global.pdOpened)).includes('https://kick.com/settings/connections'));
  await a.app.evaluate(() => (global.pdDemo.api.refuseClaims = null));
  if (await open()) await a.win.click(`#side .cat[data-cat-id="${cat}"] .cat-row`);
});

test('paused, the hero shows what comes next', async () => {
  await a.app.evaluate(() => global.pdDebug.farmer.setPaused(true));
  await until(a.win, () => document.querySelector('#hero .hero-next-row'), 'up next', 10000);
  assert.ok((await a.win.locator('#hero .hero-next-row').count()) >= 1);
  assert.match(await a.win.textContent('#hero .hero-next'), /left/);
  await a.app.evaluate(() => global.pdDebug.farmer.setPaused(false));
  await a.farming();
});

test('a short stream list says how often it is checked, and where else streams are live', async () => {
  await a.win.click('[data-action="side-tab"][data-id="streams"]');
  const few = await a.app.evaluate(() => global.pdDebug.farmer.model.categories.find((c) => c.enabled && c.needsWatching && c.streams.length && c.streams.length <= 3)?.id);
  assert.ok(few, 'a stand-in category with a few live streams');
  await a.win.click(`#side .sub-tabs [data-action="select-cat"][data-id="${few}"]`);
  await until(a.win, () => document.querySelector('#side .streams-note'), 'the note', 10000);
  assert.match(await a.win.textContent('#side .streams-note'), /live streams? counts? for .+ right now\.\s*Pear Drops looks for more every \d+ min/);
  const chip = a.win.locator('#side .streams-elsewhere [data-action="select-cat"]').first();
  const other = await chip.getAttribute('data-id');
  await chip.click();
  await until(a.win, (id) => document.querySelector(`#side .sub-tabs .tab.active[data-id="${id}"]`), 'the other category', 10000, other);
  await a.win.click('[data-action="side-tab"][data-id="queue"]');
});

test("the Credited card's sparkline counts this session, as its number does", async () => {
  const [spark, earned] = await a.win.evaluate(() => [creditBuckets().reduce((n, x) => n + x, 0), farm().timeline.filter((e) => e.type === 'credit' && e.t >= farm().stats.sessionStart && e.t > Date.now() - 120 * 60_000).reduce((n, e) => n + e.delta, 0)]);
  assert.equal(spark, earned);
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
  // Reopened, macOS hands focus back to the first button, ringed; the popover drops it.
  await pop.focus('[data-action="pause"]');
  await pop.evaluate(() => window.dispatchEvent(new Event('focus')));
  assert.equal(await pop.evaluate(() => document.querySelector('.tray :focus')), null, 'no button starts focused');
});

test('a notice of any kind is a full-width box on the dashboard and tray (a "switch" notice once drew as a toggle)', async () => {
  const pop = a.app.windows().find((x) => x.url().endsWith('tray.html'));
  assert.ok(pop, 'the tray popover from the test before');
  const box = ([sel, kind]) => {
    const n = document.querySelector(sel);
    if (n?.dataset.kind !== kind) return null;
    const [o, t] = [n, n.querySelector('span')].map((x) => x.getBoundingClientRect());
    return { kind: n.dataset.kind, cls: n.className, width: o.width, inside: t.left >= o.left && t.right <= o.right && t.top >= o.top && t.bottom <= o.bottom };
  };
  for (const kind of ['switch', 'reload', 'raid', 'ended']) {
    await a.app.evaluate((_e, k) => global.pdDebug.farmer.setNotice(k, 'Left Arcadia: drops for this stream are done'), kind);
    for (const [page, sel, min] of [[a.win, '#hero .hero-notice', 260], [pop, '.tray-notice', 300]]) {
      const n = await until(page, box, `the ${kind} notice`, 5000, [sel, kind]);
      assert.equal(n.kind, kind);
      assert.ok(!n.cls.includes(kind), `the kind isn't a class (it can clash with a component's): ${n.cls}`);
      assert.ok(n.width >= min && n.inside, `${sel} (${kind}) is ${Math.round(n.width)} px wide with its text inside`);
    }
  }
  await a.app.evaluate(() => { global.pdDebug.farmer.notice = null; global.pdDebug.farmer.changed(); });
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

test('links leave for the browser, but demo mode only records them: it never opens your real browser', async () => {
  const slug = await a.win.getAttribute('#player-head [data-action="open-kick"]', 'data-slug');
  await a.win.click('#player-head [data-action="open-kick"]');
  const opened = await until(a.win, () => true, 'the click').then(() => a.app.evaluate(() => global.pdOpened));
  assert.ok(opened.includes(`https://kick.com/${slug}`), JSON.stringify(opened));
  // Switching streams (earlier tests do it) never sends a stream's own page to the browser.
  assert.deepEqual(opened.filter((u) => /player\.kick\.com|\/popout\//.test(u)), []);
});

test('a raid sends the player to another channel: it moves on to the next stream, and nothing opens in the browser', async () => {
  const main = (fn) => a.app.evaluate(fn);
  const before = await main(() => global.pdDebug.farmer.current?.slug);
  assert.ok(before, 'watching a stream');
  await main(() => global.pdDebug.watcher.view.webContents.executeJavaScript("location.href = 'https://player.kick.com/raidtarget'"));
  let now = before;
  for (let i = 0; i < 60 && (now === before || !now); i++) {
    await a.win.waitForTimeout(250);
    now = await main(() => global.pdDebug.farmer.current?.slug);
  }
  assert.ok(now && now !== before, `moved on from ${before} (now ${now})`);
  const ended = await main(() => global.pdDebug.farmer.history.all().filter((e) => e.type === 'offline').map((e) => e.text));
  assert.ok(ended.some((t) => /sent viewers to raidtarget/.test(t)), JSON.stringify(ended));
  const opened = await main(() => global.pdOpened);
  assert.deepEqual(opened.filter((u) => /player\.kick\.com|\/popout\//.test(u)), [], 'the raid target never opens in the browser');
});

test("a stream ending sends the player to its offline screen: it moves on to the next stream, and nothing opens in the browser", async () => {
  const main = (fn, arg) => a.app.evaluate(fn, arg);
  const before = await main(() => global.pdDebug.farmer.current?.slug);
  assert.ok(before, 'watching a stream');
  await main((_e, slug) => global.pdDebug.watcher.view.webContents.executeJavaScript(`location.href = 'https://player.kick.com/${slug}/offline'`), before);
  let now = before;
  for (let i = 0; i < 60 && (now === before || !now); i++) {
    await a.win.waitForTimeout(250);
    now = await main(() => global.pdDebug.farmer.current?.slug);
  }
  assert.ok(now && now !== before, `moved on from ${before} (now ${now})`);
  const ended = await main(() => global.pdDebug.farmer.history.all().filter((e) => e.type === 'offline').map((e) => e.text));
  assert.ok(ended.some((t) => t.endsWith(' ended the stream')), JSON.stringify(ended));
  const opened = await main(() => global.pdOpened);
  assert.deepEqual(opened.filter((u) => /player\.kick\.com/.test(u)), [], 'the offline screen never opens in the browser');
});

for (const [how, spotted] of [
  ['video', /spotted: the video ended/],
  ['kick', /spotted: kick said the stream stopped/],
]) {
  test(`a stream that ends (${how === 'video' ? 'its video ends' : 'Kick says so'}) is shown at once, and the app moves on in seconds`, async () => {
    const main = (fn, arg) => a.app.evaluate(fn, arg);
    await main(() => {
      global.pdDebug.farmer.lastQuickCheckAt = 0;
      global.pdDebug.farmer.blacklist.clear();
      global.pdDemo.api.offline.clear();
    });
    const before = await main(() => global.pdDebug.farmer.current?.slug);
    assert.ok(before, 'watching a stream');
    const t0 = Date.now();
    await main((_e, h) => global.pdDemo.endStream(h), how);
    const notice = await until(a.win, (since) => { const n = document.querySelector('#hero .hero-notice'); return Number(n?.dataset.at) >= since && n.querySelector('span').textContent; }, 'the notice on the dashboard', 5000, t0);
    assert.match(notice, /stream went offline, now watching /);
    assert.ok(Date.now() - t0 < 5000, `shown and moved on in ${Date.now() - t0} ms`);
    const now = await main(() => global.pdDebug.farmer.current?.slug);
    assert.ok(now && now !== before, `moved on from ${before} (now ${now})`);
    const ended = await main((_e, slug) => global.pdDebug.farmer.history.all().filter((e) => e.type === 'offline' && e.slug === slug).map((e) => e.text), before);
    assert.ok(ended.some((t) => spotted.test(t)), JSON.stringify(ended));
  });
}

test('a frozen picture shows on the dashboard and tray within seconds, and is checked with Kick', async () => {
  const main = (fn, arg) => a.app.evaluate(fn, arg);
  await main(() => {
    global.pdDebug.farmer.lastQuickCheckAt = 0;
    global.pdDemo.api.offline.clear();
    // Earlier tests switch streams quickly, and each new page sends a watch event before any
    // credit lands: start from no conflict, so the pill shows the frozen picture, not that.
    global.pdDebug.farmer.eventsSinceCredit = 0;
  });
  await until(a.win, () => document.querySelector('#stats .player-state')?.textContent === 'Playing', 'the player to play', 15000);
  await main(() => global.pdDemo.freeze(true));
  const chip = await until(a.win, () => document.querySelector('#hero .chip.health')?.textContent, 'the health chip', 30000);
  assert.match(chip, /Frozen|Checking/);
  await until(a.win, () => /Frozen|Checking/.test(document.querySelector('#stats .player-state')?.textContent ?? ''), 'the player card', 5000);
  await a.demo((d) => d.openTray());
  let pop;
  for (let i = 0; i < 40 && !pop; i++) {
    pop = a.app.windows().find((x) => x.url().endsWith('tray.html'));
    if (!pop) await a.win.waitForTimeout(150);
  }
  await until(pop, () => /Frozen|Checking/.test(document.querySelector('.tray-stream .chip.health')?.textContent ?? ''), 'the tray chip', 10000);
  assert.match(await pop.textContent('.tray-head .status-pill'), /Frozen|Checking/, 'the pill says it in a word');
  // Asked Kick without waiting for the refresh (checks are at least 15 s apart).
  for (let i = 0; i < 100 && !(await main(() => global.pdDebug.farmer.log.some((e) => /The picture froze on .*, checking with Kick/.test(e.text)))); i++) await a.win.waitForTimeout(250);
  assert.ok(await main(() => global.pdDebug.farmer.log.some((e) => /The picture froze on .*, checking with Kick/.test(e.text))), 'checked with Kick');
  await main(() => global.pdDemo.freeze(false));
  await a.demo((d) => d.openTray());
});

test('a drop with one or two rewards gives them the room, with when each unlocks', async () => {
  const pick = await a.app.evaluate(() => {
    const c = global.pdDebug.farmer.model.categories.find((x) => x.name === 'Just Chatting' && x.streams.length);
    return c && { id: c.id, slug: c.streams[0].slug };
  });
  assert.ok(pick, 'a stand-in category with two rewards and a live stream');
  await a.win.evaluate((p) => window.pd.watch(p.slug, p.id), pick);
  await until(a.win, () => document.querySelector('#hero .hero-rewards.roomy'), 'the roomy rewards', 10000);
  assert.match(await a.win.textContent('#hero .hero-rewards'), /Unlocks .+ · /);
});
