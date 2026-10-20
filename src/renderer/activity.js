/* global render, icon, esc, widthOf, $, ui, state */
// Settings › Connected apps › Activity: what went between Pear Drops and a linked app this run
// (src/main/activity.js), newest first. A traffic chart for the last 30 minutes, the totals, and
// the messages a page at a time, as many as fit, each in plain words; a click shows its fields.

const ACT_ROW_H = 50; // px: a row, its border included (styles.css .act-row)
const ACT_FILTERS = [
  ['all', 'All'],
  ['out', 'Sent'],
  ['in', 'Received'],
  ['problems', 'Problems'],
];

const act = {
  app: null, // the app whose log is open
  filter: 'all',
  before: null, // the page: entries older than this one (null: the newest)
  pages: [], // the `before` of each newer page, for Newer
  limit: 8,
  data: null,
  open: null, // the entry shown with its fields
  seen: 0, // the newest entry already shown: newer ones flash as they come in
  flash: new Map(), // entry -> when it came in
  copied: null,
  loading: false,
  queued: false,
};

const kb = (bytes) => {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(bytes >= 100 * 1024 ? 0 : 1)} KB`;
  return `${bytes} B`;
};
const millis = (ms) => (ms < 1 ? '<1 ms' : `${ms} ms`);
/** A number in a box two digits wide, so the words after it stay put as it counts (styles.css .act-num). */
const num = (n) => `<span class="act-num">${n}</span>`;
const actTime = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const list = (names) => (names?.length ? names.join(', ') : 'nothing');

/** drops.farming's state, in words. */
function farmingWords(f) {
  if (!f || typeof f !== 'object') return 'What’s being farmed';
  if (f.state === 'farming' && f.drop) {
    const where = f.channel?.name || f.channel?.slug;
    const p = f.drop.progress;
    return `Farming ${f.drop.campaign}${where ? ` on ${where}` : ''}${p ? ` · ${Math.floor(p.done)} of ${p.total} min` : ''}`;
  }
  return { farming: 'Farming', paused: 'Paused', done: 'Every drop is done', 'signed-out': 'Signed out of Kick', waiting: 'Waiting for a stream with drops' }[f.state] ?? `State: ${f.state}`;
}

/** rewards.daily's state, in words. */
function rewardWords(r) {
  if (!r || typeof r !== 'object' || !r.state) return 'The daily reward';
  if (r.state === 'earning') return `Daily reward · ${Number.isFinite(r.minutes) ? `${r.minutes} of ${r.threshold ?? 60} min watched` : 'earning'}`;
  return { ready: 'Daily reward is ready to claim', claimed: 'Daily reward claimed for today', unavailable: 'Kick’s daily reward isn’t answering', 'signed-out': 'Signed out of Kick' }[r.state] ?? `Daily reward: ${r.state}`;
}

/** players' state, in words: signed in or out, and why (Auto: out while Pear Drops farms). */
function playersWords(p) {
  const k = p?.platforms?.kick;
  if (!k) return 'No Kick players open';
  const open = k.open?.length ?? 0;
  const state = k.signedIn ? 'signed in' : 'signed out';
  const how = { auto: k.signedIn ? 'signed in (Auto)' : 'signed out while Pear Drops farms', 'signed-in': 'signed in (always)', 'signed-out': 'signed out (always)' }[k.mode];
  return `${open} Kick player${open === 1 ? '' : 's'} open, ${how ?? `${state}${k.mode ? ` · ${k.mode}` : ''}`}`;
}

/**
 * One entry in plain words: { title (the method, or what happened), kind, text }. `name` is the
 * other app's name.
 */
function describeActivity(e, name) {
  if (e.kind === 'status' || e.kind === 'note') return { title: e.kind === 'note' ? 'Noticed' : 'Link', kind: e.kind, text: e.text ?? '' };
  const d = e.data ?? {};
  const mine = e.dir === 'out';
  const them = name;
  if (e.kind === 'error' && e.pairing) return { title: e.method, kind: 'waiting', text: mine ? `Waits until you allow ${them} to pair` : `${them} waits until you allow the pairing there` };
  if (e.kind === 'error') return { title: e.method ?? 'Error', kind: 'error', text: `${d.message ?? 'Failed'}${Number.isInteger(d.code) ? ` (${d.code})` : ''}` };
  const words = {
    'link.hello': { request: mine ? 'Hello, with what Pear Drops speaks' : `${them} said hello`, reply: mine ? `Hello back to ${them}` : `${them} said hello back` },
    'link.auth': { request: 'The pairing proof', reply: 'Pairing proof accepted' },
    'link.subscribe': {
      request: mine ? `Asked ${them} for ${list(d.events)}` : `${them} asked for ${list(d.events)}`,
      reply: mine ? `Will send ${list(d.subscribed)}` : `${them} will send ${list(d.subscribed)}`,
    },
    'link.unpair': { request: mine ? `Asked ${them} to forget the pairing` : `${them} asked to forget the pairing`, reply: 'The pairing is forgotten' },
    'link.bye': { event: `Goodbye${d.reason ? `: ${d.reason}` : ''}` },
    'drops.farming.changed': { event: farmingWords(d) },
    'drops.farming.get': { request: mine ? `Asked ${them} what’s being farmed` : `${them} asked what’s being farmed`, reply: farmingWords(d) },
    'drops.farming.show': { request: mine ? `Asked ${them} to come to the front` : `${them} asked to show Pear Drops`, reply: d.shown ? 'Shown' : 'Answered' },
    'rewards.daily.changed': { event: rewardWords(d) },
    'rewards.daily.get': { request: mine ? `Asked ${them} about the daily reward` : `${them} asked about the daily reward`, reply: rewardWords(d) },
    'rewards.daily.show': { request: mine ? `Asked ${them} to show the daily reward` : `${them} asked to show the daily reward`, reply: d.shown ? 'Shown' : 'Answered' },
    'players.changed': { event: playersWords(d) },
    'players.get': { request: mine ? `Asked ${them} about its players` : `${them} asked about the players`, reply: playersWords(d) },
  }[e.method]?.[e.kind];
  const fields = Object.keys(d).filter((k) => k !== 'seq' && k !== 'at');
  return { title: e.method ?? 'Message', kind: e.kind, text: words ?? (fields.length ? fields.join(', ') : 'No fields') };
}

/** A message's fields as path: value lines, arrays as their length: the first `max`, and how many more. */
function activityFields(data, max = 8) {
  const out = [];
  const walk = (v, path) => {
    if (Array.isArray(v)) out.push([path, `${v.length} item${v.length === 1 ? '' : 's'}`]);
    else if (v && typeof v === 'object') {
      const keys = Object.keys(v);
      if (!keys.length) out.push([path || '(empty)', '{}']);
      for (const k of keys) walk(v[k], path ? `${path}.${k}` : k);
    } else out.push([path, v === null ? 'null' : String(v)]);
  };
  walk(data ?? {}, '');
  return { fields: out.slice(0, max), more: Math.max(0, out.length - max) };
}

/** Messages a minute, the last 30 minutes: sent (green) under received (blue), a red mark for a problem. */
function trafficChart(minutes, width, height = 64) {
  const pad = { l: 2, r: 2, t: 6, b: 16 };
  const h = height - pad.t - pad.b;
  const top = Math.max(4, ...minutes.map((m) => m.out + m.in));
  const slot = (width - pad.l - pad.r) / minutes.length;
  const bw = Math.max(2, slot - 3);
  const now = Date.now();
  const bars = minutes
    .map((m, i) => {
      const x = pad.l + i * slot + (slot - bw) / 2;
      const ho = (m.out / top) * h;
      const hi = (m.in / top) * h;
      const base = pad.t + h;
      const at = new Date(now - (minutes.length - 1 - i) * 60_000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const tip = `${at} · ${m.out} sent, ${m.in} received${m.bad ? `, ${m.bad} problem${m.bad === 1 ? '' : 's'}` : ''}`;
      return `<g data-tip="${esc(tip)}"><rect class="act-hit" x="${(pad.l + i * slot).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${height - pad.b}"/>
        <rect class="act-bar-bg" x="${x.toFixed(1)}" y="${pad.t}" width="${bw.toFixed(1)}" height="${h}" rx="2"/>
        ${m.out ? `<rect class="act-bar-out" x="${x.toFixed(1)}" y="${(base - ho).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(2, ho).toFixed(1)}" rx="2"/>` : ''}
        ${m.in ? `<rect class="act-bar-in" x="${x.toFixed(1)}" y="${(base - ho - hi - (m.out ? 1 : 0)).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(2, hi).toFixed(1)}" rx="2"/>` : ''}
        ${m.bad ? `<circle class="act-bar-bad" cx="${(x + bw / 2).toFixed(1)}" cy="${(base - ho - hi - 5).toFixed(1)}" r="2.5"/>` : ''}</g>`;
    })
    .join('');
  const y = height - 3;
  const labels = `<text x="${pad.l}" y="${y}" class="act-axis">30 min ago</text><text x="${(width / 2).toFixed(1)}" y="${y}" class="act-axis" text-anchor="middle">15 min</text><text x="${width - pad.r}" y="${y}" class="act-axis" text-anchor="end">now</text>`;
  return `<svg class="act-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${bars}${labels}</svg>`;
}

async function loadActivity() {
  if (!act.app) return;
  if (act.loading) {
    act.queued = true;
    return;
  }
  act.loading = true;
  try {
    act.data = await window.pd.connected.activity(act.app, { filter: act.filter, before: act.before, limit: act.limit });
  } catch {
    act.data = null;
  } finally {
    act.loading = false;
    if (act.queued) {
      act.queued = false;
      loadActivity();
    } else render();
  }
}

function openActivity(id) {
  Object.assign(act, { app: id, filter: 'all', before: null, pages: [], open: null, data: null, seen: Infinity });
  loadActivity();
  render();
}

function closeActivity() {
  act.app = null;
  act.data = null;
  render();
}

/** After drawing: as many rows as the list has room for (it never scrolls), and the chart at its width. */
function fitActivity() {
  const el = $('.act-list');
  if (!act.app || !el) return;
  const room = el.clientHeight - ($('.act-detail')?.offsetHeight ?? 0);
  const rows = Math.max(3, Math.floor(room / ACT_ROW_H));
  if (rows !== act.limit) {
    act.limit = rows;
    loadActivity();
  }
  const chart = $('.act-chart');
  const width = widthOf(chart, 560);
  if (chart && chart.__width !== width && act.data) {
    chart.__width = width;
    render();
  }
}

/** The view, for the Connected apps tab. `peer` is that app's card (link.peers()). */
function activityPane(peer) {
  const d = act.data;
  const name = esc(peer?.name ?? act.app);
  const logo = ui.appIcons?.[act.app] ? `<img class="act-logo" src="${ui.appIcons[act.app]}" alt="" />` : '<span class="act-logo"></span>';
  const linked = peer?.status === 'connected';
  const chip = linked ? `<span class="chip green"><span class="live-dot green"></span>Linked${peer.version ? ` · ${esc(peer.version)}` : ''}</span>` : '<span class="chip">Not linked</span>';
  const t = d?.totals ?? { sent: 0, received: 0, bytesOut: 0, bytesIn: 0, problems: 0, ping: null };
  const ago = t.ping ? Math.max(0, Math.round((Date.now() - t.ping.at) / 1000)) : null;
  const stat = (cls, ic, label, value, sub) =>
    `<div class="act-stat ${cls}"><span class="act-stat-label">${icon(ic)}${label}</span><span class="act-stat-value"><b>${value}</b>${sub ? `<em>${sub}</em>` : ''}</span></div>`;
  const stats = `<div class="act-stats">
    ${stat('out', 'arrowRight', 'Sent', t.sent, kb(t.bytesOut))}
    ${stat('in', 'arrowLeft', 'Received', t.received, kb(t.bytesIn))}
    ${stat('beat', 'pulse', 'Heartbeat', t.ping?.ms != null ? (t.ping.ms < 1 ? '&lt;1 ms' : `${num(t.ping.ms)} ms`) : t.ping ? 'OK' : '—', ago === null ? '' : ago < 60 ? `${num(ago)}s ago` : `${num(Math.round(ago / 60))}m ago`)}
    ${stat(d?.problems ? 'bad' : 'calm', 'alert', 'Problems', d?.problems ?? 0, '')}
  </div>`;
  const chartEl = $('.act-chart');
  const chart = d ? trafficChart(d.minutes, widthOf(chartEl, 560)) : '';
  const tabs = `<div class="tabs act-filters">${ACT_FILTERS.map(
    ([id, label]) =>
      `<button class="tab ${act.filter === id ? 'active' : ''}" data-action="act-filter" data-id="${id}">${label}${id === 'problems' && d?.problems ? `<span class="act-count">${d.problems}</span>` : ''}</button>`,
  ).join('')}</div>`;
  const first = d ? d.newer + 1 : 0;
  const last = d ? d.newer + d.entries.length : 0;
  const pager = d?.total
    ? `<div class="act-pager">
        ${act.before !== null ? `<button class="btn sm ghost act-newest" data-action="act-newest">${icon('up')} Newest</button>` : ''}
        <span class="act-range">${first}–${last} of ${d.total}</span>
        <button class="btn sm icon-only" data-action="act-newer" data-tip="Newer" ${act.before === null ? 'disabled' : ''}>${icon('chevronLeft')}</button>
        <button class="btn sm icon-only" data-action="act-older" data-tip="Older" ${last >= d.total ? 'disabled' : ''}>${icon('chevronRight')}</button>
      </div>`
    : '';
  // Rows that just came in flash once (for a moment, through the page's once-a-second redraws).
  const seen = act.seen === Infinity ? (d?.latest ?? 0) : act.seen;
  const now = Date.now();
  for (const e of d?.entries ?? []) if (e.n > seen && !act.flash.has(e.n)) act.flash.set(e.n, now);
  for (const [n, at] of act.flash) if (now - at > 1600) act.flash.delete(n);
  const fresh = (e) => act.flash.has(e.n);
  const row = (e) => {
    const w = describeActivity(e, peer?.name ?? act.app);
    const time = `<span class="act-time">${actTime(e.at)}</span>`;
    if (e.kind === 'status' || e.kind === 'note') {
      const ic = e.kind === 'note' ? 'alert' : e.about === 'players' ? 'clock' : 'link';
      return `<div class="act-row act-marker tone-${e.tone || 'plain'} ${fresh(e) ? 'fresh' : ''}" data-n="${e.n}">${time}<span class="act-marker-line"></span>
        <span class="act-pill">${icon(ic)}<span>${esc(w.text)}</span></span><span class="act-marker-line"></span></div>`;
    }
    const cap = (e.method ?? '').startsWith('link.') ? 'link' : (e.method ?? '').startsWith('players.') ? 'players' : 'drops';
    const meta = [e.ms != null ? millis(e.ms) : '', e.bytes ? kb(e.bytes) : ''].filter(Boolean);
    const isOpen = act.open === e.n;
    const bad = e.kind === 'error' && !e.pairing;
    const head = `<button class="act-row ${e.dir} k-${bad || e.kind !== 'error' ? e.kind : 'pairing'} ${isOpen ? 'open' : ''} ${fresh(e) ? 'fresh' : ''}" data-action="act-toggle" data-n="${e.n}">
      ${time}
      <span class="act-dir" data-tip="${e.dir === 'out' ? `Pear Drops → ${name}` : `${name} → Pear Drops`}">${icon(bad ? 'alert' : e.dir === 'out' ? 'arrowRight' : 'arrowLeft')}</span>
      <span class="act-body"><span class="act-title"><span class="act-method cap-${cap}">${esc(w.title)}</span><span class="act-kind">${esc(w.kind)}</span></span>
        <span class="act-text">${esc(w.text)}</span></span>
      <span class="act-meta">${meta.map((m) => `<span>${m}</span>`).join('')}</span>
    </button>`;
    if (!isOpen) return head;
    const hidden = e.data === undefined;
    const { fields, more } = activityFields(e.data);
    const lines = Math.min(4, Math.ceil(fields.length / 2)) || 1;
    const grid = hidden
      ? '<p class="act-hidden">Not shown: the hello and the pairing proof hold the pairing’s secrets.</p>'
      : `<dl class="act-fields">${fields.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v.length > 80 ? `${v.slice(0, 80)}…` : v)}</dd></div>`).join('')}</dl>`;
    const foot = `<div class="act-detail-foot"><span>${[e.id != null ? `id ${esc(String(e.id))}` : '', more ? `${more} more field${more === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')}</span>
      ${hidden ? '' : `<button class="btn sm ghost" data-action="act-copy" data-n="${e.n}">${icon(act.copied === e.n ? 'check' : 'copy')} ${act.copied === e.n ? 'Copied' : 'Copy JSON'}</button>`}</div>`;
    return `${head}<div class="act-detail" style="--lines:${hidden ? 1 : lines}">${grid}${foot}</div>`;
  };
  const empty = (() => {
    if (!d) return '';
    if (act.filter === 'problems') return ['check', 'No problems', `Everything between Pear Drops and ${name} went through this run.`];
    if (act.filter !== 'all') return ['pulse', 'Nothing yet', `Nothing ${act.filter === 'out' ? 'sent' : 'received'} this run.`];
    return ['pulse', 'Nothing yet', linked ? `Messages between Pear Drops and ${name} show here as they happen.` : `Switch on Connect with ${name}, and the messages between the two show here as they happen.`];
  })();
  const rows = d?.entries.length
    ? d.entries.map(row).join('')
    : d
      ? `<div class="act-empty"><span class="act-empty-icon">${icon(empty[0])}</span><b>${empty[1]}</b><span>${empty[2]}</span></div>`
      : '';
  if (d && act.before === null) act.seen = d.latest;
  else if (d && act.seen === Infinity) act.seen = d.latest;
  const since = d ? new Date(d.started).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  return `<div class="act-who">${logo}<div><b>${name}</b><span>Every message between the two since ${since}, kept until Pear Drops quits.</span></div>${chip}</div>
    ${stats}
    <div class="act-chart-card"><div class="act-chart-head"><b>Last 30 minutes</b><span class="act-legend"><i class="out"></i>Sent<i class="in"></i>Received<i class="bad"></i>Problem</span></div><div class="act-chart">${chart}</div></div>
    <div class="act-bar">${tabs}${pager}</div>
    <div class="act-list">${rows}</div>`;
}

const activityActions = {
  'act-open-app': (el) => openActivity(el.dataset.id),
  'act-close': () => closeActivity(),
  'act-filter': (el) => {
    Object.assign(act, { filter: el.dataset.id, before: null, pages: [], open: null });
    loadActivity();
  },
  'act-older': () => {
    const last = act.data?.entries.at(-1);
    if (!last) return;
    act.pages.push(act.before);
    act.before = last.n;
    act.open = null;
    loadActivity();
  },
  'act-newer': () => {
    act.before = act.pages.pop() ?? null;
    act.open = null;
    loadActivity();
  },
  'act-newest': () => {
    Object.assign(act, { before: null, pages: [], open: null });
    loadActivity();
  },
  'act-toggle': (el) => {
    const n = Number(el.dataset.n);
    act.open = act.open === n ? null : n;
    render();
    fitActivity();
  },
  'act-copy': async (el) => {
    const e = act.data?.entries.find((x) => x.n === Number(el.dataset.n));
    if (!e) return;
    await navigator.clipboard.writeText(JSON.stringify({ method: e.method, kind: e.kind, dir: e.dir, at: new Date(e.at).toISOString(), data: e.data }, null, 2)).catch(() => {});
    act.copied = e.n;
    render();
    setTimeout(() => {
      act.copied = null;
      render();
    }, 1500);
  },
};

// New messages: the open log follows them (on its newest page; older pages stay put).
window.pd.connected.onActivity(() => {
  if (act.app && ui.modal === 'settings' && ui.settingsTab === 'apps' && state) loadActivity();
});
