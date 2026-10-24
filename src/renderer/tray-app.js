/* global rowArt, rewardChest, rewardCard, playReveal, endReveal, revealDone, revealFor, openTab, previewAttrs, icon, brandMark, progressRing, MIN, $, esc, fmtDur, fmtMin, fmtAgo, fmtCount, fmtFinish, streamHealth, streamNotice, setHTML, img, applyFont */
// The tray / menu bar popover: the live state at a glance, with quick controls.
let state = null;
let page = 'main'; // or 'reward': the daily reward's card, claimed right here
let revealing = false;
let rewardTab = null; // the crate open on the reward page (its tab): chosen as it opens

/** Kick's daily reward, or null before the first answer. */
function dailyReward() {
  return state?.dailyReward ?? null;
}

function campaignsOf(f) {
  return f.categories.flatMap((c) => c.campaigns);
}

function primary(f) {
  if (!f.current) return null;
  const list = campaignsOf(f).filter((c) => f.current.campaignIds.includes(c.id));
  return list.sort((a, b) => (f.forecast[a.id]?.nextMinutes ?? 1e9) - (f.forecast[b.id]?.nextMinutes ?? 1e9))[0] ?? null;
}

/** The status pill: a word or two. The card under it has the whole story, so it isn't said twice. */
function statusLine(f) {
  if (f.conflict) return ['conflict', 'Credit taken'];
  const health = streamHealth(f);
  if (health && f.status.code === 'farming' && health.state !== 'playing') return [health.tone === 'bad' ? 'error' : 'waiting', health.label];
  const map = { farming: ['farming', 'Farming'], paused: ['paused', 'Paused'], waiting: ['waiting', 'Waiting'], done: ['done', 'All done'], error: ['error', 'Offline'], starting: ['waiting', 'Starting'] };
  return map[f.status.code] ?? ['waiting', 'Waiting'];
}

/** The live dot by the streamer's name, or what's wrong with the stream right now. */
function healthMark(f) {
  const h = streamHealth(f);
  if (!h || h.state === 'playing') return '<span class="live-dot"></span>';
  return `<span class="chip ${h.tone === 'bad' ? 'red' : 'amber'} health">${h.state === 'checking' || h.state === 'loading' ? '<span class="spinner xs"></span>' : icon('alert')}${h.label}</span>`;
}

/** What just happened to the stream (it ended, a raid, a reload), for a minute. */
function noticeLine(f) {
  const n = streamNotice(f);
  return n ? `<div class="tray-notice" data-kind="${n.kind}">${icon(n.icon)}<span>${esc(n.text)}</span><small>${fmtAgo(n.at)}</small></div>` : '';
}

function render() {
  const root = $('#tray');
  if (!state) return;
  applyFont(state.settings?.font);
  if (state.auth.status !== 'signed-in' || !state.farm) {
    setHTML(
      root,
      `<div class="tray-head">${brandMark(24)}<b>Pear <span>Drops</span></b></div>
      <div class="tray-empty">${icon('lock')}<div>${state.auth.status === 'signed-in' ? 'Loading drops…' : 'Sign in to start collecting drops.'}</div></div>
      <div class="tray-foot"><button class="btn primary" data-action="show">${icon('panel')} Open Pear Drops</button><span class="spacer"></span>
      <button class="btn icon-only ghost" data-action="quit" data-tip="Quit Pear Drops">${icon('power')}</button></div>`,
    );
    return fit();
  }
  const dr = dailyReward();
  if (page === 'reward' && dr && !['signed-out', 'hidden'].includes(dr.state)) {
    // The reveal owns the card until it's over.
    if (!revealing) setHTML(root, rewardCard(dr, { where: 'tray', tab: rewardTab }));
    return fit();
  }
  page = 'main';
  const f = state.farm;
  const cur = f.current;
  const p = primary(f);
  const fc = p ? f.forecast[p.id] : null;
  const frac = p ? p.units / Math.max(1, p.targetUnits) : 0;
  const [tone, text] = statusLine(f);
  const tracked = f.categories.flatMap((c) => c.campaigns.flatMap((x) => x.rewards.filter((r) => r.tracked)));
  const collected = { done: tracked.filter((r) => r.claimed).length, all: tracked.length };
  const next = f.categories.filter((c) => c.enabled && c.needsWatching && c.id !== cur?.targetId).slice(0, 3);

  const now = cur
    ? `<div class="tray-now">
        <div class="tray-stream">${img(cur.avatar, 'avatar')}<div class="who"><b>${esc(cur.username)} ${healthMark(f)}</b><span>${esc(cur.categoryName)} · ${fmtCount(cur.viewers)} watching</span></div></div>
        <div class="tray-progress">
          ${progressRing(frac, { size: 96, stroke: 8, label: `${Math.floor(frac * 100)}%`, sub: p ? `${p.units}/${p.targetUnits}m` : '' })}
          <div class="tray-eta">
            <div class="tray-camp">${esc(p?.name ?? '')}</div>
            <dl class="eta">
              <dt>Next reward</dt><dd>${p?.next ? fmtMin(fc?.nextMinutes) : 'claiming…'}</dd>
              <dt>All done</dt><dd>${fmtMin(fc?.doneMinutes)}</dd>
              <dt>Finishes</dt><dd>${fmtFinish(fc?.doneMinutes)}</dd>
              <dt>Last credit</dt><dd>${fmtAgo(cur.lastProgressAt)}</dd>
            </dl>
          </div>
        </div>
        <div class="tray-rewards">${(p?.rewards ?? [])
          .filter((r) => r.tracked)
          .map(
            (r) => `<div class="tray-reward ${r.claimed ? 'claimed' : r.ready ? 'ready' : ''}" ${previewAttrs(r, p.units)}>
              ${img(r.image)}<span>${r.claimed ? icon('check') : `${Math.min(100, Math.floor((p.units / r.required) * 100))}%`}</span></div>`,
          )
          .join('')}</div>
      </div>`
    : `<div class="tray-empty">${icon(f.paused ? 'pause' : f.status.code === 'done' ? 'trophy' : 'clock')}<div>${esc(f.paused ? 'Paused. Nothing is being watched.' : f.status.message)}</div></div>`;

  setHTML(
    root,
    `<div class="tray-head">${brandMark(24)}<b>Pear <span>Drops</span></b><span class="spacer"></span>
      <span class="status-pill ${tone}">${tone === 'farming' ? '<span class="live-dot green"></span>' : '<span class="status-dot"></span>'}<span class="label">${esc(text)}</span></span>${rewardChest(dr, { where: 'tray' })}</div>
    ${noticeLine(f)}
    ${f.conflict ? `<div class="tray-alert">${icon('alert')}<span><b>Close other Kick streams.</b> ${f.eventsSinceCredit} watch events got no credit.</span></div>` : ''}
    ${now}
    <div class="tray-stats">
      <div><b>${fmtDur(f.stats.watchMs)}</b><span>watched</span></div>
      <div><b>${f.stats.earned}m</b><span>credited</span></div>
      <div data-tip="Emotes and badges collected across all active drops"><b>${collected.done}/${collected.all}</b><span>collected</span></div>
    </div>
    ${
      next.length
        ? `<div class="tray-next"><div class="eyebrow">Up next</div>${next
            .map((c) => {
              const tracked = c.campaigns.flatMap((x) => x.rewards.filter((r) => r.tracked));
              const done = tracked.filter((r) => r.claimed).length;
              return `<div class="tray-cat">${rowArt(c, 'tray-cat-art')}<div class="tray-cat-info"><b>${esc(c.name)}</b>
                <div class="mini-bar"><i style="width:${tracked.length ? (done / tracked.length) * 100 : 0}%"></i></div></div>
                <span>${c.kind !== 'category' && c.liveChannels.length ? (c.channels.length === 1 ? 'live' : `${c.liveChannels.length} of ${c.channels.length} live`) : c.streamCount ? `${c.streamCount} live` : 'offline'}</span></div>`;
            })
            .join('')}</div>`
        : ''
    }
    <div class="tray-foot">
      ${f.paused ? `<button class="btn primary sm" data-action="resume">${icon('play')} Resume</button>` : `<button class="btn sm" data-action="pause">${icon('pause')} Pause</button>`}
      ${cur ? `<button class="btn sm" data-action="skip">${icon('skip')} Skip</button>` : ''}
      <span class="spacer"></span>
      <button class="btn sm" data-action="show">${icon('panel')} Dashboard</button>
      <button class="btn sm icon-only ghost" data-action="quit" data-tip="Quit Pear Drops (stops farming)">${icon('power')}</button>
    </div>`,
  );
  fit();
}

function fit() {
  window.pd.tray.resize(Math.ceil($('#tray').getBoundingClientRect().height) + 2);
}
new ResizeObserver(() => fit()).observe($('#tray'));

const actions = {
  show: () => window.pd.tray.showMain(),
  quit: () => window.pd.tray.quit(),
  pause: () => window.pd.tray.action('pause'),
  resume: () => window.pd.tray.action('resume'),
  skip: () => window.pd.tray.action('skip'),
  'reward-open': () => {
    page = 'reward';
    // It opens on a crate that's ready (the daily one first).
    rewardTab = openTab(dailyReward());
    window.pd.dailyReward.opened();
    render();
  },
  'reward-back': () => {
    if (revealing) return revealDone();
    page = 'main';
    render();
  },
  'reward-claim': (el) => reveal(el.closest('.dr-card'), el.dataset.id, () => window.pd.dailyReward.claim(el.dataset.id)),
  'reward-replay': (el) => reveal(el.closest('.dr-card'), el.dataset.id, () => window.pd.dailyReward.lastClaim(el.dataset.id)),
  'reward-done': () => revealDone(),
  'reward-collection': () => window.pd.openExternal('https://kick.com/collectibles'),
  'reward-prizes': () => window.pd.openExternal('https://kick.com/drops/rewards'),
  'reward-tab': (el) => {
    if (revealing) return;
    rewardTab = el.dataset.id;
    render();
  },
  'reward-kick': () => window.pd.openExternal('https://kick.com/?daily-reward=open'),
};

/** Claims (or replays) the daily reward or the event crate `id`, with the whole reveal in the popover, until Done. */
async function reveal(card, id, get) {
  if (revealing || !card) return;
  revealing = true;
  for (const b of card.querySelectorAll('.dr-claim')) b.setAttribute('disabled', '');
  const how = revealFor(dailyReward(), id);
  const r = await get();
  if (r?.winner) {
    card.classList.add('revealing');
    await playReveal(card.querySelector('.dr-reveal'), r, { ...how, tile: 92 });
  }
  endReveal(card);
  revealing = false;
  render();
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (target) actions[target.dataset.action]?.(target);
});

async function refresh() {
  state = await window.pd.getState();
  render();
}

window.pd.onState((next) => {
  state = next;
  render();
});
// Reopening the popover hands focus back to its first button (with a focus ring); start with nothing focused.
window.addEventListener('focus', () => {
  document.activeElement?.blur();
  refresh();
});
refresh();
setInterval(render, 1000);
