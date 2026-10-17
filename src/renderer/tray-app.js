/* global previewAttrs, icon, brandMark, progressRing, MIN, $, esc, fmtDur, fmtMin, fmtAgo, fmtCount, fmtEta, setHTML, img */
// The tray / menu bar popover: the live state at a glance, with quick controls.
let state = null;

function campaignsOf(f) {
  return f.categories.flatMap((c) => c.campaigns);
}

function primary(f) {
  if (!f.current) return null;
  const list = campaignsOf(f).filter((c) => f.current.campaignIds.includes(c.id));
  return list.sort((a, b) => (f.forecast[a.id]?.nextMinutes ?? 1e9) - (f.forecast[b.id]?.nextMinutes ?? 1e9))[0] ?? null;
}

function statusLine(f) {
  if (f.conflict) return ['conflict', 'Another stream is taking your credit'];
  const map = { farming: 'farming', paused: 'paused', waiting: 'waiting', done: 'done', error: 'error', starting: 'waiting' };
  return [map[f.status.code] ?? 'waiting', f.status.message];
}

function render() {
  const root = $('#tray');
  if (!state) return;
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
  const f = state.farm;
  const cur = f.current;
  const p = primary(f);
  const fc = p ? f.forecast[p.id] : null;
  const frac = p ? p.units / Math.max(1, p.targetUnits) : 0;
  const [tone, text] = statusLine(f);
  const tracked = f.categories.flatMap((c) => c.campaigns.flatMap((x) => x.rewards.filter((r) => r.tracked)));
  const collected = { done: tracked.filter((r) => r.claimed).length, all: tracked.length };
  const next = f.categories.filter((c) => c.enabled && c.needsWatching && c.id !== cur?.categoryId).slice(0, 3);

  const now = cur
    ? `<div class="tray-now">
        <div class="tray-stream">${img(cur.avatar, 'avatar')}<div class="who"><b>${esc(cur.username)} <span class="live-dot"></span></b><span>${esc(cur.categoryName)} · ${fmtCount(cur.viewers)} watching</span></div></div>
        <div class="tray-progress">
          ${progressRing(frac, { size: 96, stroke: 8, label: `${Math.floor(frac * 100)}%`, sub: p ? `${p.units}/${p.targetUnits}m` : '' })}
          <div class="tray-eta">
            <div class="tray-camp">${esc(p?.name ?? '')}</div>
            <dl class="eta">
              <dt>Next reward</dt><dd>${p?.next ? fmtMin(fc?.nextMinutes) : 'claiming…'}</dd>
              <dt>All done</dt><dd>${fmtEta(fc?.doneMinutes)}</dd>
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
      <span class="status-pill ${tone}">${tone === 'farming' ? '<span class="live-dot green"></span>' : '<span class="status-dot"></span>'}<span class="label">${esc(tone === 'farming' ? 'Farming' : text)}</span></span></div>
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
              return `<div class="tray-cat">${img(c.image, 'tray-cat-art')}<div class="tray-cat-info"><b>${esc(c.name)}</b>
                <div class="mini-bar"><i style="width:${tracked.length ? (done / tracked.length) * 100 : 0}%"></i></div></div>
                <span>${c.streamCount ? `${c.streamCount} live` : 'offline'}</span></div>`;
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
  window.kdf.tray.resize(Math.ceil($('#tray').getBoundingClientRect().height) + 2);
}

const actions = {
  show: () => window.kdf.tray.showMain(),
  quit: () => window.kdf.tray.quit(),
  pause: () => window.kdf.tray.action('pause'),
  resume: () => window.kdf.tray.action('resume'),
  skip: () => window.kdf.tray.action('skip'),
};

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (target) actions[target.dataset.action]?.();
});

async function refresh() {
  state = await window.kdf.getState();
  render();
}

window.kdf.onState((next) => {
  state = next;
  render();
});
window.addEventListener('focus', refresh);
refresh();
setInterval(render, 1000);
