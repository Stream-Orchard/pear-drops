/* global render, icon, MIN, $, esc, fmtDur, fmtMin, fmtClock, fmtCount, setHTML, img, progressChart, ui, state, farm */
// The History view: an overview dashboard of everything recorded, filterable by
// time range and by drop, with a timeline, watch sessions and channels.

const RANGES = [
  ['24h', 'Last 24 hours', 86_400_000],
  ['7d', '7 days', 7 * 86_400_000],
  ['30d', '30 days', 30 * 86_400_000],
  ['all', 'All time', 0],
];

const GROUP_CHIPS = [
  ['progress', 'Progress', 'bolt'],
  ['rewards', 'Rewards', 'gift'],
  ['watching', 'Watching', 'play'],
  ['problems', 'Problems', 'alert'],
  ['app', 'App', 'pulse'],
];

// type -> [label, icon, tone]
const EVENT_KIND = {
  credit: ['Credit', 'bolt', 'green'],
  'credit-elsewhere': ['Credit lost', 'alert', 'red'],
  unlock: ['Unlocked', 'sparkle', 'gold'],
  claim: ['Claimed', 'gift', 'gold'],
  'claim-failed': ['Claim failed', 'alert', 'red'],
  'campaign-complete': ['Drop complete', 'trophy', 'gold'],
  'category-complete': ['Category done', 'trophy', 'gold'],
  'campaign-ended': ['Drop ended', 'clock', 'amber'],
  'campaign-back': ['Drop back', 'reload', 'green'],
  'watch-start': ['Started', 'play', 'blue'],
  'watch-end': ['Stopped', 'skip', 'blue'],
  stall: ['Stall', 'clock', 'amber'],
  reload: ['Reload', 'reload', 'amber'],
  crash: ['Player crash', 'alert', 'red'],
  offline: ['Offline', 'eye', 'amber'],
  conflict: ['Conflict', 'bell', 'red'],
  'not-eligible': ['Not eligible', 'x', 'amber'],
  priority: ['Moved up', 'up', 'amber'],
  decision: ['Decision', 'target', 'blue'],
  error: ['Error', 'alert', 'red'],
  start: ['App', 'pulse', 'muted'],
  pause: ['Paused', 'pause', 'muted'],
  resume: ['Resumed', 'play', 'muted'],
  login: ['Signed in', 'lock', 'muted'],
  logout: ['Signed out', 'logout', 'muted'],
  wake: ['Woke up', 'pulse', 'muted'],
  follow: ['Followed', 'heart', 'green'],
  unfollow: ['Unfollowed', 'heart', 'muted'],
};

const hist = {
  range: '7d',
  campaignId: null,
  table: 'timeline',
  groups: [],
  text: '',
  data: null,
  loading: false,
  queued: false,
  loadedAt: 0,
};

function histSince() {
  const r = RANGES.find(([id]) => id === hist.range);
  return r[2] ? Date.now() - r[2] : 0;
}

async function loadHistory() {
  if (hist.loading) {
    hist.queued = true;
    return;
  }
  hist.loading = true;
  try {
    hist.data = await window.pd.history({ since: histSince(), campaignId: hist.campaignId, groups: hist.groups, text: hist.text, limit: 600 });
    hist.loadedAt = Date.now();
  } finally {
    hist.loading = false;
    if (hist.queued) {
      hist.queued = false;
      loadHistory();
    } else if (ui.view === 'history') renderHistory();
  }
}

const fmtDay = (t) => new Date(t).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
const fmtStamp = (t) => {
  const d = new Date(t);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return `${sameDay ? 'Today' : d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};
const fmtHour = (h) => new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' });
const pct = (v) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);

// ------------------------------------------------------------------ charts

/**
 * The activity chart: minutes watched (grey) and credited (green) per day, or per hour while
 * there's under three days to show. Claims are a gold dot, with a count when there are more.
 */
function activityChart(activity, width, height) {
  const hourly = activity?.unit === 'hour';
  const pad = { l: 38, r: 8, t: 16, b: 22 };
  const w = Math.max(100, width - pad.l - pad.r);
  const h = Math.max(60, height - pad.t - pad.b);
  const list = activity?.bars?.length ? activity.bars : [{ t: Date.now(), day: Date.now(), watched: 0, credited: 0, claims: 0 }];
  const top = Math.max(hourly ? 60 : 30, ...list.map((d) => d.watched), ...list.map((d) => d.credited));
  // An hour holds 60 minutes and a day 24 hours: the scale never needs more.
  const nice = hourly ? [60, 90, 120].find((n) => n >= top) ?? top : [30, 60, 120, 180, 240, 360, 480, 600, 720, 960, 1440].find((n) => n >= top) ?? 1440;
  const bw = w / list.length;
  const y = (v) => pad.t + h - (Math.min(v, nice) / nice) * h;
  const grid = [0, 0.5, 1]
    .map((f) => {
      const v = nice * f;
      const label = v === 0 ? '0' : v >= 60 && !hourly ? `${+(v / 60).toFixed(1)}h` : `${v}m`;
      return `<line x1="${pad.l}" x2="${pad.l + w}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end" class="axis">${label}</text>`;
    })
    .join('');
  const labelEvery = hourly ? Math.max(1, Math.ceil(list.length / Math.max(1, Math.floor(w / 52)))) : Math.ceil(list.length / Math.max(1, Math.floor(w / 46)));
  const nowHour = new Date();
  nowHour.setMinutes(0, 0, 0);
  const bars = list
    .map((d, i) => {
      const t = d.t ?? d.day;
      const x = pad.l + i * bw;
      // Bars spread across the chart, never wider than a bar should look.
      const inner = Math.max(3, Math.min(hourly ? 18 : 34, bw * 0.55));
      const cx = x + bw / 2 - inner / 2;
      const current = hourly ? t === nowHour.getTime() : new Date(t).toDateString() === new Date().toDateString();
      const when = hourly ? `${fmtDay(t)} ${fmtHour(new Date(t).getHours())}` : fmtDay(t);
      const label = hourly ? (current ? 'Now' : fmtHour(new Date(t).getHours())) : current ? 'Today' : new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
      const claim = d.claims
        ? d.claims > 1
          ? `<circle cx="${cx + inner / 2}" cy="${y(d.watched) - 10}" r="7" class="hb-claim"/><text x="${cx + inner / 2}" y="${y(d.watched) - 6.5}" text-anchor="middle" class="claim-count">${d.claims}</text>`
          : `<circle cx="${cx + inner / 2}" cy="${y(d.watched) - 8}" r="4" class="hb-claim"/>`
        : '';
      return `<g><title>${when}: watched ${fmtMin(d.watched)}, credited ${d.credited} min${d.claims ? `, ${d.claims} claimed` : ''}</title>
        <rect x="${cx}" y="${y(d.watched)}" width="${inner}" height="${pad.t + h - y(d.watched)}" rx="${Math.min(5, inner / 2)}" class="bar-watched"/>
        <rect x="${cx}" y="${y(d.credited)}" width="${inner}" height="${pad.t + h - y(d.credited)}" rx="${Math.min(5, inner / 2)}" class="bar-credited ${current ? 'today' : ''}"/>
        ${claim}
        ${(list.length - 1 - i) % labelEvery === 0 || current ? `<text x="${x + bw / 2}" y="${height - 6}" text-anchor="middle" class="axis ${current ? 'today' : ''}">${label}</text>` : ''}</g>`;
    })
    .join('');
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${grid}${bars}</svg>`;
}

function hourHeatmap(hours) {
  const top = Math.max(1, ...hours);
  const cells = hours.map((m, h) => `<div class="heat-cell" style="--v:${(m / top).toFixed(3)}" data-tip="${String(h).padStart(2, '0')}:00 · ${fmtMin(m)} watched"></div>`).join('');
  const labels = hours.map((_, h) => `<span>${h % 6 === 0 ? fmtHour(h) : ''}</span>`).join('');
  return `<div class="heat"><div class="heat-row">${cells}</div><div class="heat-row labels">${labels}</div></div>`;
}

// ------------------------------------------------------------------ table views

function timelineRows(events) {
  // Collapse runs of credits from the same watch session into one row.
  const rows = [];
  for (const e of events) {
    const prev = rows[rows.length - 1];
    if (e.type === 'credit' && prev?.type === 'credit' && prev.session === e.session && prev.campaignId === e.campaignId) {
      prev.count += 1;
      prev.delta += e.delta ?? 0;
      prev.fromUnits = (e.units ?? 0) - (e.delta ?? 0);
      prev.firstT = e.t;
      continue;
    }
    rows.push({ ...e, count: 1, delta: e.delta ?? 0, fromUnits: (e.units ?? 0) - (e.delta ?? 0), firstT: e.t });
  }
  return rows;
}

function timelineTable(d) {
  const rows = timelineRows(d.events);
  if (!rows.length) return `<div class="empty">${icon('list')}Nothing recorded for this filter yet.</div>`;
  return `<table class="htable"><thead><tr><th>When</th><th>Event</th><th>Drop</th><th>Stream</th><th>Details</th><th class="r">Minutes</th></tr></thead><tbody>${rows
    .map((e) => {
      const [label, ic, tone] = EVENT_KIND[e.type] ?? ['Event', 'pulse', 'muted'];
      const isRun = e.type === 'credit' && e.count > 1;
      const detail = isRun ? `${e.count} credits · ${e.fromUnits} → ${e.units} min` : e.reward ? `${img(e.rewardImage, 'tiny-img')}${esc(e.text ?? e.reward)}` : esc(e.text ?? '');
      const when = isRun ? `${fmtStamp(e.firstT)} – ${new Date(e.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : fmtStamp(e.t);
      return `<tr class="ev-${e.group}">
        <td class="nowrap muted num">${when}</td>
        <td><span class="ev ${tone}">${icon(ic)}${label}</span></td>
        <td class="ellipsis">${e.campaign ? `<button class="link" data-action="hist-campaign" data-id="${esc(e.campaignId)}">${esc(e.campaign)}</button>` : esc(e.category ?? '')}</td>
        <td class="ellipsis">${e.channel ? `${img(e.avatar, 'avatar xs')}${esc(e.channel)}` : ''}</td>
        <td class="ellipsis detail" ${(e.text ?? '').length > 60 ? `data-tip="${esc(e.text)}"` : ''}>${detail}</td>
        <td class="r num">${e.type === 'credit' ? `<b class="pos">+${e.delta}</b>` : e.type === 'credit-elsewhere' ? `<b class="neg">−${e.delta}</b>` : e.minutes ? `${e.minutes}m` : ''}</td>
      </tr>`;
    })
    .join('')}</tbody></table>`;
}

/** Why a session ended, without the figures in brackets ("IRL ends sooner (6d 22h vs …)"); hover has them. */
const shortReason = (reason) => reason.replace(/\s*\([^)]*\)\s*$/, '');

function sessionsTable(d) {
  if (!d.sessions.length) return `<div class="empty">${icon('play')}No watch sessions in this range.</div>`;
  return `<table class="htable"><thead><tr><th>Stream</th><th>Drop</th><th>Started</th><th class="r">Watched</th><th class="r">Credited</th><th>Efficiency</th><th>Issues</th><th>Ended</th></tr></thead><tbody>${d.sessions
    .map(
      (s) => `<tr>
        <td class="sess-stream"><div class="sess-cell">${img(s.avatar, 'avatar xs')}<span class="sess-who"><span class="sess-name"><b>${esc(s.channel)}</b>${s.manual ? ' <span class="chip blue tiny">you</span>' : ''}</span>${s.title ? `<span class="sess-title" data-tip="${esc(s.title)}">${esc(s.title)}</span>` : ''}</span></div></td>
        <td class="ellipsis">${esc((s.campaigns ?? []).join(', ') || s.category || '')}</td>
        <td class="nowrap muted num">${fmtStamp(s.start)}</td>
        <td class="r num">${fmtDur(s.ms)}</td>
        <td class="r num"><b class="pos">${s.credited}m</b></td>
        <td>${effBar(s.efficiency)}</td>
        <td class="nowrap">${s.stalls ? `<span class="chip amber tiny">${s.stalls} stall${s.stalls > 1 ? 's' : ''}</span>` : ''}${s.reloads ? ` <span class="chip tiny">${s.reloads} reload${s.reloads > 1 ? 's' : ''}</span>` : ''}</td>
        <td class="ellipsis muted" ${s.reason && shortReason(s.reason) !== s.reason ? `data-tip="${esc(s.reason)}"` : ''}>${s.open ? '<span class="chip green tiny"><span class="live-dot green"></span>Watching now</span>' : esc(shortReason(s.reason ?? ''))}</td>
      </tr>`,
    )
    .join('')}</tbody></table>`;
}

function channelsTable(d) {
  if (!d.channels.length) return `<div class="empty">${icon('users')}No channels watched in this range.</div>`;
  return `<table class="htable"><thead><tr><th>Channel</th><th class="r">Sessions</th><th class="r">Watched</th><th class="r">Credited</th><th>Efficiency</th><th class="r">Stalls</th><th>Last watched</th></tr></thead><tbody>${d.channels
    .map(
      (c) => `<tr>
        <td class="ellipsis">${img(c.avatar, 'avatar xs')}<b>${esc(c.channel)}</b></td>
        <td class="r num">${c.sessions}</td>
        <td class="r num">${fmtDur(c.watchMs)}</td>
        <td class="r num"><b class="pos">${c.credited}m</b></td>
        <td>${effBar(c.efficiency)}</td>
        <td class="r num">${c.stalls || ''}</td>
        <td class="nowrap muted num">${fmtStamp(c.lastAt)}</td>
      </tr>`,
    )
    .join('')}</tbody></table>`;
}

function effBar(v) {
  if (v === null || v === undefined) return '<span class="muted">—</span>';
  const tone = v >= 0.85 ? 'good' : v >= 0.5 ? 'warn' : 'bad';
  return `<span class="eff-wrap"><span class="eff ${tone}"><i style="width:${Math.round(v * 100)}%"></i></span><span class="num eff-v">${pct(v)}</span></span>`;
}

// ------------------------------------------------------------------ render

function renderHistory() {
  const el = $('#history');
  const d = hist.data;
  if (!d) {
    setHTML(el, `<div class="hist-loading"><div class="spinner"></div>Loading history…</div>`);
    if (!hist.loading) loadHistory();
    return;
  }
  const live = farm();
  const liveCampaign = live?.categories.flatMap((c) => c.campaigns).find((c) => c.id === hist.campaignId);
  const recorded = d.campaigns.find((c) => c.campaignId === hist.campaignId);
  const liveCat = live?.categories.find((k) => k.campaigns.some((c) => c.id === hist.campaignId));
  // Each drop's details as the app saved them, for drops Kick no longer lists.
  const saved = (id) => d.drops?.[id] ?? null;
  const savedSel = saved(hist.campaignId);
  // The focused drop, from its history or (with nothing recorded yet) from the live or saved drops.
  const selected = hist.campaignId
    ? recorded ??
      (liveCampaign
        ? { campaignId: liveCampaign.id, campaign: liveCampaign.name, category: liveCat?.name, required: liveCampaign.targetUnits, firstAt: null, empty: true }
        : savedSel
          ? { campaignId: savedSel.id, campaign: savedSel.name, category: savedSel.category, categoryId: savedSel.categoryId, required: savedSel.targetUnits, firstAt: null, empty: true }
          : { campaignId: hist.campaignId, campaign: 'This drop', empty: true })
    : null;
  const selectedImage = liveCat?.image ?? live?.categories.find((k) => k.id === recorded?.categoryId)?.image ?? savedSel?.image;
  const rangeLabel = { '24h': 'the last 24 hours', '7d': 'the last 7 days', '30d': 'the last 30 days', all: 'all time' }[hist.range];
  const t = d.totals;
  // Under three days, the chart is by hour, and "When you farm" would only repeat it.
  const byHour = !selected && d.activity?.unit === 'hour';

  const kpi = (ic, tone, label, value, foot) => `<div class="card stat"><div class="stat-head"><span class="stat-icon ${tone}">${icon(ic)}</span>${label}</div><div class="stat-value">${value}</div><div class="stat-foot"><span>${foot}</span></div></div>`;

  const chartEl = el.querySelector('.hist-daily-chart');
  const cw = Math.max(300, (chartEl?.clientWidth || 700) - 4);
  const ch = Math.max(120, (chartEl?.clientHeight || 200) - 4);
  const seriesEl = el.querySelector('.hist-series-chart');

  // The focused drop stays in the list (and highlighted) even before it has any history.
  const dropList = selected?.empty ? [{ ...selected, categoryId: liveCat?.id ?? selected.categoryId, credited: 0, watchMs: 0, claims: 0, units: liveCampaign?.units ?? savedSel?.units ?? 0 }, ...d.campaigns] : d.campaigns;
  const drops = dropList
    .map((c) => {
      const lc = live?.categories.flatMap((k) => k.campaigns).find((x) => x.id === c.campaignId);
      const cat = live?.categories.find((k) => k.id === c.categoryId);
      const sv = saved(c.campaignId);
      const units = lc?.units ?? sv?.units ?? c.units;
      const target = lc?.targetUnits || sv?.targetUnits || c.required || 0;
      const done = lc?.complete ?? (sv ? sv.status === 'completed' : c.complete);
      const missed = !lc && sv?.status === 'missed';
      return `<button class="drop-item ${c.campaignId === hist.campaignId ? 'active' : ''}" data-action="hist-campaign" data-id="${esc(c.campaignId)}">
        ${img(cat?.image ?? sv?.image, 'drop-art')}
        <span class="drop-info"><b>${esc(c.campaign ?? 'Unknown drop')}</b><span class="muted">${esc(c.category ?? '')} · ${fmtDur(c.watchMs)} watched</span>
        <span class="mini-bar"><i style="width:${target ? Math.min(100, (units / target) * 100) : done ? 100 : 0}%"></i></span></span>
        <span class="drop-stats"><b class="pos">+${c.credited}m</b><span>${done ? `${icon('check')} done` : missed ? (sv.total > sv.claimed ? `missed ${sv.total - sv.claimed}` : 'ended') : c.claims ? `${c.claims} claimed` : target ? `${units}/${target}` : ''}</span></span>
      </button>`;
    })
    .join('');

  const series = d.series?.length
    ? progressChart({
        points: d.series,
        rewards: (liveCampaign?.rewards ?? savedSel?.rewards ?? []).map((r) => ({ ...r })),
        target: liveCampaign?.targetUnits || savedSel?.targetUnits || selected?.required || Math.max(...d.series.map((p) => p[1])),
        now: Date.now(),
        rate: 0,
        forecast: false,
        idPrefix: 'pch',
        width: Math.max(300, (seriesEl?.clientWidth || 640) - 4),
        height: Math.max(140, (seriesEl?.clientHeight || 200) - 4),
      })
    : `<div class="empty">${icon('target')}No credits recorded for ${esc(selected?.campaign ?? 'this drop')} ${rangeLabel === 'all time' ? 'yet' : `in ${rangeLabel} yet`}.<span class="muted">It shows here once the app has watched it.</span></div>`;

  // Every active filter as a removable chip.
  const filters = [];
  if (selected) filters.push(`<button class="filter-chip" data-action="hist-campaign" data-id="" data-tip="Show all drops">${img(selectedImage, 'tiny-img')}<span><em>Drop</em> ${esc(selected.campaign)}</span>${icon('x')}</button>`);
  for (const g of hist.groups) {
    const chip = GROUP_CHIPS.find(([id]) => id === g);
    filters.push(`<button class="filter-chip" data-action="hist-group" data-id="${g}" data-tip="Remove this filter">${icon(chip[2])}<span><em>Events</em> ${chip[1]}</span>${icon('x')}</button>`);
  }
  if (hist.text) filters.push(`<button class="filter-chip" data-action="hist-clear-search" data-tip="Clear the search">${icon('list')}<span><em>Search</em> “${esc(hist.text)}”</span>${icon('x')}</button>`);
  const filterBar = filters.length
    ? `<div class="filter-bar"><span class="eyebrow">Showing</span>${filters.join('')}<span class="muted">· ${rangeLabel}</span><button class="link small" data-action="hist-clear">${icon('x')} Clear filters</button></div>`
    : '';

  const table = hist.table === 'sessions' ? sessionsTable(d) : hist.table === 'channels' ? channelsTable(d) : timelineTable(d);
  const searchFocused = document.activeElement?.id === 'hist-search';

  setHTML(
    el,
    `<div class="hist-toolbar">
      <div class="hist-title">${selected ? img(selectedImage, 'hist-title-art') : ''}<h2>${selected ? esc(selected.campaign) : 'History'}</h2>
        <span class="card-sub">${selected ? `${esc(selected.category ?? '')}${selected.firstAt ? ` · first seen ${fmtStamp(selected.firstAt)}` : ' · nothing recorded yet'}${!liveCampaign && savedSel ? ` · ${savedSel.status === 'missed' ? (savedSel.total > savedSel.claimed ? `missed ${savedSel.total - savedSel.claimed} of ${savedSel.total}` : 'ended') : 'completed'}${savedSel.onKick ? '' : ', saved after Kick removed it'}` : ''}` : d.first ? `All drops · recording since ${fmtDay(d.first)}` : 'Nothing recorded yet'}</span></div>
      ${selected ? `<button class="chip green clear-chip" data-action="hist-campaign" data-id="">${icon('chevronLeft')} All drops</button>` : ''}
      <div class="spacer"></div>
      <div class="tabs">${RANGES.map(([id, label]) => `<button class="tab ${hist.range === id ? 'active' : ''}" data-action="hist-range" data-id="${id}">${label}</button>`).join('')}</div>
    </div>
    ${filterBar}
    <div class="stats hist-kpis">
      ${kpi('clock', 'teal', 'Watch time', fmtDur(t.watchMs), `${t.sessions} sessions<span class="opt"> · ${t.channels} channels</span>`)}
      ${kpi('bolt', 'green', 'Credited', `${fmtCount(t.credited)}<small>min</small>`, `<span class="${(t.efficiency ?? 1) >= 0.85 ? 'delta-up' : 'delta-down'}">${pct(t.efficiency)}</span> efficient`)}
      ${kpi('gift', 'gold', 'Claimed', `${t.claims}<small>rewards</small>`, `${t.unlocks} unlocked · ${t.completed} done`)}
      ${kpi('reload', 'amber', 'Recoveries', `${t.stalls + t.reloads + t.offline}`, `${t.stalls} stalls · ${t.reloads} reloads`)}
      ${kpi('bell', t.conflicts ? 'red' : 'violet', 'Conflicts', `${t.conflicts}`, t.elsewhere ? `${t.elsewhere} min lost` : 'no credit lost')}
      ${
        selected
          ? kpi('trophy', 'violet', 'This drop', liveCampaign ? `${liveCampaign.units}<small>/ ${liveCampaign.targetUnits || '—'} min</small>` : selected.empty ? '—' : `${selected.units}<small>min</small>`, liveCampaign ? (liveCampaign.complete ? 'complete' : `${fmtMin(liveCampaign.remainingUnits)} of watching left`) : 'no longer active')
          : kpi('trophy', 'violet', 'Drops', `${d.campaigns.length}`, `${d.campaigns.filter((c) => c.complete).length} finished in range`)
      }
    </div>
    <div class="hist-grid">
      <div class="card hist-chart-card">
        <div class="card-head"><div class="card-title">${icon(selected ? 'target' : 'pulse')} ${selected ? 'Drop progress' : byHour ? 'Activity by hour' : 'Daily activity'}</div>
          ${selected ? '' : '<div class="legend"><span><i style="background:rgba(255,255,255,.14)"></i>Watched</span><span><i style="background:var(--green)"></i>Credited</span><span><i style="background:var(--gold);border-radius:50%"></i>Claim</span></div>'}
        </div>
        <div class="${selected ? 'hist-series-chart' : 'hist-daily-chart'}">${selected ? series : activityChart(d.activity, cw, ch)}</div>
        ${byHour ? '' : `<div class="hist-hours"><span class="eyebrow">When you farm</span>${hourHeatmap(d.hourly)}</div>`}
      </div>
      <div class="card hist-drops">
        <div class="card-head"><div class="card-title">${icon('gift')} Drops</div><span class="card-sub">click to focus</span></div>
        <div class="drop-list">${drops || `<div class="empty">${icon('gift')}No drops yet.</div>`}</div>
      </div>
      <div class="card hist-table-card">
        <div class="hist-table-head">
          <div class="side-tabs flat">${[
            ['timeline', 'list', 'Timeline'],
            ['sessions', 'play', 'Watch sessions'],
            ['channels', 'users', 'Channels'],
          ]
            .map(([id, ic, label]) => `<button class="side-tab ${hist.table === id ? 'active' : ''}" data-action="hist-table" data-id="${id}">${icon(ic)}${label}</button>`)
            .join('')}</div>
          <div class="spacer"></div>
          ${
            hist.table === 'timeline'
              ? `<div class="group-chips">${GROUP_CHIPS.map(([id, label, ic]) => `<button class="chip ${hist.groups.includes(id) ? 'green' : ''}" data-action="hist-group" data-id="${id}" data-tip="${label} events">${icon(ic)}<span class="chip-label">${label}</span></button>`).join('')}</div>
                 <input id="hist-search" class="search" type="search" placeholder="Search events" value="${esc(hist.text)}" spellcheck="false" />`
              : ''
          }
        </div>
        <div class="hist-table-body">${table}</div>
      </div>
    </div>`,
  );
  // Charts are sized from their boxes: draw again once the layout has settled.
  const box = el.querySelector(selected ? '.hist-series-chart' : '.hist-daily-chart');
  const used = selected ? [Math.max(300, (seriesEl?.clientWidth || 640) - 4), Math.max(140, (seriesEl?.clientHeight || 200) - 4)] : [cw, ch];
  if (box && (Math.abs(box.clientWidth - 4 - used[0]) > 2 || Math.abs(box.clientHeight - 4 - used[1]) > 2) && !hist.resized) {
    hist.resized = true;
    requestAnimationFrame(() => renderHistory());
  } else hist.resized = false;
  if (searchFocused) {
    const input = $('#hist-search');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
}

const historyActions = {
  'hist-range': (el) => {
    hist.range = el.dataset.id;
    loadHistory();
  },
  'hist-campaign': (el) => {
    hist.campaignId = el.dataset.id && el.dataset.id !== hist.campaignId ? el.dataset.id : null;
    ui.view = 'history';
    loadHistory();
    render();
  },
  'hist-clear': () => {
    hist.campaignId = null;
    hist.groups = [];
    hist.text = '';
    loadHistory();
  },
  'hist-clear-search': () => {
    hist.text = '';
    loadHistory();
  },
  'hist-table': (el) => {
    hist.table = el.dataset.id;
    renderHistory();
  },
  'hist-group': (el) => {
    const g = el.dataset.id;
    hist.groups = hist.groups.includes(g) ? hist.groups.filter((x) => x !== g) : [...hist.groups, g];
    loadHistory();
  },
};

let searchTimer = null;
document.addEventListener('input', (event) => {
  if (event.target.id !== 'hist-search') return;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    hist.text = event.target.value;
    loadHistory();
  }, 250);
});
