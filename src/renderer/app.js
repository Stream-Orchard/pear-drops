/* global activityPane, activityActions, act, fitActivity, closeActivity, previewAttrs, updatesPane, updateChip, whatsNewModal, updateActions, initUpdates, renderHistory, loadHistory, historyActions, hist, icon, brandMark, progressRing, progressChart, heartbeatStrip, sparkBars, MIN, $, esc, fmtDur, fmtMin, fmtClock, fmtAgo, fmtCount, fmtEnds, fmtEta, popupWall, streamHealth, streamNotice, setHTML, widthOf, img, applyFont */

let state = null;
const ui = {
  selectedCategory: null,
  chartCampaign: null,
  expanded: new Set(),
  sideTab: 'queue',
  pastFilter: 'all',
  view: 'dashboard',
  playerOpen: true,
  modal: null,
  seenToasts: new Set(),
  firstState: true,
};

// ------------------------------------------------------------------ derived data

function farm() {
  return state?.farm;
}

function allCampaigns() {
  return (farm()?.categories ?? []).flatMap((c) => c.campaigns);
}

function currentCampaigns() {
  const f = farm();
  if (!f?.current) return [];
  return allCampaigns().filter((c) => f.current.campaignIds.includes(c.id));
}

function primaryCampaign() {
  const f = farm();
  const list = currentCampaigns();
  if (!list.length) return null;
  return [...list].sort((a, b) => (f.forecast[a.id]?.nextMinutes ?? 1e9) - (f.forecast[b.id]?.nextMinutes ?? 1e9))[0];
}

function categoryEta(cat) {
  const f = farm();
  const active = cat.campaigns.filter((c) => c.needsWatching);
  if (!active.length) return 0;
  const mins = active.map((c) => f.forecast[c.id]?.doneMinutes ?? c.remainingUnits);
  // Campaigns open to the whole category progress together from one stream.
  return active.every((c) => !c.channels.length) ? Math.max(...mins) : mins.reduce((a, b) => a + b, 0);
}

function trackedRewards(cat) {
  return cat.campaigns.flatMap((c) => c.rewards.filter((r) => r.tracked));
}

// Credits per 10-minute bucket over the last two hours.
/** Credits in 10-minute buckets for the Credited card's sparkline: this session only, as its number is. */
function creditBuckets(buckets = 12) {
  const now = Date.now();
  const out = new Array(buckets).fill(0);
  const since = farm()?.stats.sessionStart ?? 0;
  for (const e of farm()?.timeline ?? []) {
    if (e.type !== 'credit' || e.t < since) continue;
    const i = buckets - 1 - Math.floor((now - e.t) / (10 * MIN));
    if (i >= 0 && i < buckets) out[i] += e.delta;
  }
  return out;
}

// ------------------------------------------------------------------ welcome

function renderWelcome() {
  const status = state?.auth?.status ?? 'checking';
  const cta =
    status === 'checking'
      ? `<div class="signing"><div class="spinner"></div>Checking your Kick login…</div>`
      : status === 'signing-in'
        ? `<div class="signing"><div class="spinner"></div>Finish signing in in the Kick window…</div>
           <button class="btn" data-action="login">Show sign-in window</button>`
        : `<button class="btn primary lg" data-action="login">${icon('play')} Sign in with Kick</button>`;

  setHTML(
    $('#welcome'),
    `<div class="welcome-left">
      <div class="brand">${brandMark(40)}<span class="brand-name" style="font-size:18px">Pear <b>Drops</b></span></div>
      <h1>Collect every <em>emote &amp; badge</em> drop on autopilot.</h1>
      <p class="lede">Pear Drops watches the right streams for you, claims rewards the moment they unlock, and moves on to the next category when you're done. You get on with your day.</p>
      <div class="features">
        <div class="feature"><div class="fi">${icon('target')}</div><div><b>Finds eligible streams</b><span>Live channels in each drop's category, with the ones you follow first.</span></div></div>
        <div class="feature"><div class="fi">${icon('pulse')}</div><div><b>Watches like you would</b><span>Runs Kick's real player and chat, with the sound muted at the window.</span></div></div>
        <div class="feature"><div class="fi">${icon('bolt')}</div><div><b>Fixes stalls, claims for you</b><span>Reloads or switches streams when progress stops, and claims the moment a drop unlocks.</span></div></div>
      </div>
      <div class="welcome-cta">${cta}</div>
      <div class="welcome-note">${icon('lock')} Your login stays on this computer, encrypted with your system keychain. Game-account drops are skipped.</div>
    </div>
    <div class="welcome-right">
      <div class="showcase">
        <div class="orbit"></div><div class="orbit o2"></div><div class="orbit o3"></div>
        <div class="core">${brandMark(160)}</div>
        <div class="token" style="left:6%;top:18%;animation-delay:-1s;color:var(--green)">${icon('sparkle')}</div>
        <div class="token" style="right:4%;top:10%;animation-delay:-3s;color:var(--gold)">${icon('trophy')}</div>
        <div class="token" style="right:10%;bottom:14%;animation-delay:-2s;color:var(--teal)">${icon('gift')}</div>
        <div class="token" style="left:14%;bottom:8%;animation-delay:-5s;color:var(--violet)">${icon('bolt')}</div>
      </div>
    </div>`,
  );
}

// ------------------------------------------------------------------ titlebar

function statusInfo() {
  const f = farm();
  if (!f) return { cls: 'waiting', text: 'Loading drops…' };
  if (f.conflict) return { cls: 'conflict', text: 'Another stream is taking your credit' };
  // A stream in trouble shows here at once, before the app has moved on.
  const health = streamHealth(f);
  if (health && f.status.code === 'farming' && ['checking', 'frozen'].includes(health.state)) return { cls: health.tone === 'bad' ? 'error' : 'waiting', text: f.health.text };
  const code = f.status.code;
  const map = { farming: 'farming', paused: 'paused', waiting: 'waiting', done: 'done', error: 'error', starting: 'waiting' };
  return { cls: map[code] ?? 'waiting', text: f.status.message };
}

function renderTitlebar() {
  const f = farm();
  setHTML(
    $('#nav'),
    [
      ['dashboard', 'pulse', 'Dashboard'],
      ['history', 'list', 'History'],
    ]
      .map(([id, ic, label]) => `<button class="nav-item ${ui.view === id ? 'active' : ''}" data-action="view" data-id="${id}">${icon(ic)}${label}</button>`)
      .join(''),
  );
  const s = statusInfo();
  const dot = s.cls === 'farming' ? '<span class="live-dot green"></span>' : '<span class="status-dot"></span>';
  setHTML($('#status-pill'), `<div class="status-pill ${s.cls}">${dot}<span class="label">${esc(s.text)}</span></div>`);

  const user = state.auth.user;
  const next = f?.nextTickAt ? Math.max(0, f.nextTickAt - Date.now()) : 0;
  const total = (state.settings.refreshSeconds || 60) * 1000;
  const frac = f?.ticking ? 1 : 1 - next / total;
  // The refresh countdown sits inside the refresh button: a ring that fills up to the next refresh.
  const refresh = f
    ? `<button class="tb-refresh ${f.ticking ? 'busy' : ''}" data-action="refresh" data-tip="${f.ticking ? 'Refreshing from Kick…' : `Next refresh in ${Math.ceil(next / 1000)}s. Click to refresh now`}">
        <svg class="countdown-ring" viewBox="0 0 22 22"><circle cx="11" cy="11" r="9" stroke="rgba(255,255,255,.08)" stroke-width="2" fill="none"/>
        <circle cx="11" cy="11" r="9" stroke="var(--green)" stroke-width="2" fill="none" stroke-linecap="round" stroke-dasharray="${(2 * Math.PI * 9).toFixed(2)}" stroke-dashoffset="${(2 * Math.PI * 9 * (1 - frac)).toFixed(2)}" transform="rotate(-90 11 11)"/></svg>
        ${icon('refresh')}<span class="num">${f.ticking ? '···' : `${Math.ceil(next / 1000)}s`}</span></button>`
    : '';
  setHTML(
    $('#titlebar-actions'),
    `${updateChip()}${refresh}
    ${
      f?.paused
        ? `<button class="tb-btn resume" data-action="resume" data-tip="Start collecting again">${icon('play')}<span>Resume</span></button>`
        : f
          ? `<button class="tb-btn" data-action="pause" data-tip="Stop watching for now">${icon('pause')}<span>Pause</span></button>`
          : ''
    }
    <span class="titlebar-divider"></span>
    <button class="tb-btn icon-only" data-action="settings" data-tip="Settings">${icon('settings')}</button>
    <button class="user-btn" data-action="settings" data-tip="Account and settings">${img(user?.avatar, 'avatar')}<span>${esc(user?.username ?? '')}</span></button>`,
  );
}

// ------------------------------------------------------------------ banner + hero

function renderBanner() {
  const f = farm();
  if (!f?.conflict) {
    // Credit is back: the alarm stops by itself. (The alert can arrive just before
    // the state that shows the conflict, so only a conflict seen here can clear it.)
    if (alarm.sawConflict) stopAlarm();
    alarm.sawConflict = false;
    return setHTML($('#banner'), '');
  }
  alarm.sawConflict = true;
  // A linked Stream Multiview whose Kick players are signed in is the likely culprit: say so.
  const linked = signedInPlayers(state.connected);
  setHTML(
    $('#banner'),
    `<div class="banner">
      <div class="icon-wrap">${icon('alert')}</div>
      <div class="text"><b>Another Kick stream is taking your drop credit</b>
      <span>${f.eventsSinceCredit} watch events sent with no credit. ${
        linked
          ? `${esc(linked.name)} has Kick players open that are signed in. Turn on <span class="banner-em">Sign Kick players out while Pear Drops is farming</span> there, or close them.`
          : 'Kick credits only one stream per account, so close any other streams to continue progressing drops.'
      }</span></div>
      ${linked ? `<button class="btn sm" data-action="open-connected-apps">${icon('link')} Connected apps</button>` : ''}
      ${alarm.timer ? `<button class="btn sm stop-alarm" data-action="stop-alarm">${icon('volumeOff')} Stop alarm</button>` : ''}
    </div>`,
  );
}

/** One reward in the hero. Roomy (one or two to show) adds when it unlocks, at the current rate. */
function rewardLine(r, units, { roomy = false, rate = 1 } = {}) {
  const pct = Math.min(1, units / r.required);
  const cls = r.claimed ? 'claimed' : r.ready ? 'ready' : '';
  const status = r.claimed
    ? `<span class="rl-status ok">${icon('check')} Claimed</span>`
    : r.claimError
      ? `<span class="rl-status bad" data-tip="${esc(r.claimError.text)}">${icon('alert')} Couldn’t claim</span>`
      : r.ready
      ? `<span class="rl-status ready">Ready to claim</span>`
      : `<span class="rl-status num">${Math.min(units, r.required)}/${r.required}m</span>`;
  return `<div class="reward-line ${cls}" ${previewAttrs(r, units)}>
    <div class="reward-img">${img(r.image, '', r.name)}</div>
    <div class="rl-body"><div class="rl-top"><span class="reward-name">${esc(r.name)}</span>${status}</div>
    <div class="mini-bar"><i style="width:${(pct * 100).toFixed(1)}%"></i></div>
    ${roomy && !r.claimed ? `<span class="rl-eta">${r.ready ? 'Ready: claiming it now' : `Unlocks ${fmtEta((r.required - units) / Math.max(0.05, rate))}`}</span>` : ''}</div>
  </div>`;
}

/** The LIVE chip by the streamer's name, or what's wrong with the stream right now. */
function healthChip(f) {
  const h = streamHealth(f);
  if (!h || h.state === 'playing') return '<span class="chip red"><span class="live-dot"></span>LIVE</span>';
  const spin = h.state === 'checking' || h.state === 'loading' ? '<span class="spinner xs"></span>' : icon('alert');
  return `<span class="chip ${h.tone === 'bad' ? 'red' : 'amber'} health" data-tip="${esc(f.health.text)}">${spin}${h.label}</span>`;
}

/** What just happened to the stream, over the hero's corner for a minute (it doesn't move the layout). */
function noticeHTML(f) {
  const n = streamNotice(f);
  if (!n) return '';
  return `<div class="hero-notice ${n.kind}" data-at="${n.at}">${icon(n.icon)}<span>${esc(n.text)}</span><small>${fmtAgo(n.at)}</small></div>`;
}

/** The time to the next check with Kick, as a ring that empties. */
function checkRing(f) {
  const span = Math.max(1, f.nextTickAt - (f.checkedAt ?? f.nextTickAt - state.settings.refreshSeconds * 1000));
  const left = Math.max(0, Math.min(1, (f.nextTickAt - Date.now()) / span));
  const c = 2 * Math.PI * 6;
  return `<svg class="check-ring" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="6" class="left" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - left)).toFixed(2)}"/></svg>`;
}

function renderHero() {
  const f = farm();
  const hero = $('#hero');
  if (!f) {
    return setHTML(hero, `<div class="hero-empty"><div class="orb"><div class="spinner"></div></div><div><h2>Loading your drops…</h2><p>Fetching campaigns, your progress and live streams from Kick.</p></div></div>`);
  }
  const cur = f.current;
  const cat = f.categories.find((c) => c.id === cur?.categoryId);

  if (!cur) {
    const next = f.categories.find((c) => c.enabled && c.needsWatching);
    const copy = {
      paused: [icon('pause'), 'Paused', 'Nothing is being watched. Resume when you want to keep collecting drops.', `<button class="btn primary" data-action="resume">${icon('play')} Resume farming</button>`],
      done: [icon('trophy'), 'All caught up', f.status.message + '. New campaigns are picked up automatically.', ''],
      waiting: [
        icon('clock'),
        'Waiting for a live stream',
        next ? `None of the channels for ${esc(next.name)} or the other remaining drops are live right now.` : f.status.message,
        `<button class="btn" data-action="refresh">${icon('refresh')} Check now</button>`,
      ],
      error: [icon('alert'), 'Kick is not responding', f.status.message, `<button class="btn" data-action="refresh">${icon('refresh')} Try again</button>`],
      starting: [`<div class="spinner"></div>`, 'Getting ready…', 'Fetching campaigns, progress and live streams.', ''],
    }[f.status.code] ?? [icon('clock'), f.status.message, '', ''];
    // What comes next, so a pause or a wait still shows where things stand.
    const upNext = f.categories.filter((c) => c.enabled && c.needsWatching).slice(0, 3);
    const nextCheck = f.status.code === 'waiting' && f.nextTickAt ? `<span class="hero-next-check">${checkRing(f)} Checking again in ${fmtDur(Math.max(0, f.nextTickAt - Date.now()))}</span>` : '';
    // Each check with Kick pulses the orb and runs a line of light along the top. Keyed by the
    // check, so each plays once, and only while it's new (not again on every redraw).
    const tone = { paused: 'paused', done: 'done', error: 'warn' }[f.status.code] ?? 'scan';
    const fresh = f.checkedAt && Date.now() - f.checkedAt < 10_000;
    const ping = fresh ? `<span class="orb-ping" data-key="ping-${f.checkedAt}"></span><span class="orb-ping late" data-key="ping-late-${f.checkedAt}"></span>` : '';
    const sweep = fresh ? `<span class="hero-sweep" data-key="sweep-${f.checkedAt}"></span>` : '';
    const nextList = upNext.length
      ? `<div class="hero-next"><div class="eyebrow">Up next</div>${upNext
          .map(
            (c) => `<div class="hero-next-row">${img(c.image, 'hero-next-art', c.name)}<span class="hero-next-name"><b>${esc(c.name)}</b><span>${c.streamCount ? `${c.streamCount} live` : 'nothing live'}</span></span><span class="hero-next-left num">${fmtMin(categoryEta(c))}<small>left</small></span></div>`,
          )
          .join('')}${nextCheck}</div>`
      : '';
    return setHTML(
      hero,
      `<div class="hero-bg" style="${next?.image ? `background-image:url('${esc(next.image)}')` : ''}"></div>${sweep}
      <div class="hero-empty hero-${tone}"><div class="orb" style="color:${f.status.code === 'done' ? 'var(--gold)' : 'var(--muted)'}">${copy[0]}${ping}</div>
      <div style="flex:1"><div class="eyebrow" style="margin-bottom:8px">${f.paused ? 'Paused' : 'Standing by'}</div><h2>${copy[1]}</h2><p>${copy[2]}</p>${copy[3] ? `<div class="hero-empty-action">${copy[3]}</div>` : ''}</div>${nextList}</div>
      ${noticeHTML(f)}`,
    );
  }

  const primary = primaryCampaign();
  const fc = primary ? f.forecast[primary.id] : null;
  const frac = primary ? primary.units / Math.max(1, primary.targetUnits) : 0;
  const quiet = Date.now() - cur.lastProgressAt;
  const stallFrac = Math.min(1, quiet / (f.stallMinutes * MIN));
  const stallColor = stallFrac < 0.5 ? 'var(--green)' : stallFrac < 0.85 ? 'var(--amber)' : 'var(--red)';
  const names = currentCampaigns().map((c) => c.name);

  // The next rewards still to unlock come first; at most three fit.
  const allRewards = currentCampaigns().flatMap((c) => c.rewards.filter((r) => r.tracked).map((r) => ({ r, units: c.units })));
  const ordered = [...allRewards.filter((x) => !x.r.claimed), ...allRewards.filter((x) => x.r.claimed)];
  const shown = ordered.slice(0, 3);
  // One or two rewards get the room three would take: bigger, with when each unlocks.
  const roomy = shown.length <= 2;
  const more = ordered.length - shown.length;

  setHTML(
    hero,
    `<div class="hero-bg" style="${cat?.image ? `background-image:url('${esc(cat.image)}')` : ''}"></div>
    <div class="hero-inner">
      <div class="hero-head">
        <span class="eyebrow" style="color:var(--green)">Now farming</span>
        <h1 class="hero-title">${esc(names[0] ?? cat?.name)} <span class="hero-cat">· ${esc(cur.categoryName)}</span></h1>
        ${cur.manual ? '<span class="chip blue">Picked by you</span>' : ''}
        ${names.length > 1 ? `<span class="chip">${names.length} campaigns at once</span>` : ''}
      </div>
      <div class="hero-grid">
        <div class="hero-stream">
          <div class="hs-top">
            ${img(cur.avatar, 'avatar lg ring-live')}
            <div class="who">
              <div class="name">${esc(cur.username)} ${cur.followed ? icon('heart') : ''}</div>
              <div class="hs-meta">${healthChip(f)}<span class="chip flat num">${icon('eye')} ${fmtCount(cur.viewers)}</span></div>
            </div>
          </div>
          <div class="title">${esc(cur.title ?? '')}</div>
          <div class="hero-actions">
            <button class="btn sm" data-action="reload" data-tip="Reload the player">${icon('reload')} Reload</button>
            <button class="btn sm" data-action="skip" data-tip="Switch to another stream">${icon('skip')} Skip stream</button>
          </div>
        </div>
        <div class="hero-rewards ${roomy ? 'roomy' : ''}">
          ${shown.map(({ r, units }) => rewardLine(r, units, { roomy, rate: fc?.rate ?? 1 })).join('')}
          ${more > 0 ? `<button class="more-rewards" data-action="side-tab" data-id="queue">+${more} more rewards</button>` : ''}
        </div>
        <div class="hero-side">
          ${progressRing(frac, { size: 124, stroke: 10, label: `${Math.floor(frac * 100)}%`, sub: primary ? `${primary.units} / ${primary.targetUnits} min` : '' })}
          <dl class="eta">
            <dt>Next reward</dt><dd>${primary?.next ? fmtEta(fc?.nextMinutes) : 'claiming…'}</dd>
            <dt>Campaign done</dt><dd>${fmtEta(fc?.doneMinutes)}</dd>
            <dt class="opt">Credit rate</dt><dd class="opt">${fc ? `${fc.rate.toFixed(2)}×${fc.observed ? '' : ' est.'}` : '—'}</dd>
            <dt class="opt">Watching for</dt><dd class="opt">${fmtDur(Date.now() - cur.startedWatchingAt)}</dd>
          </dl>
        </div>
      </div>
    </div>
    ${noticeHTML(f)}
    <div class="hero-stall">
      <span>Last credit <b>${fmtAgo(cur.lastProgressAt)}</b></span>
      <div class="stall-track"><i style="width:${(stallFrac * 100).toFixed(1)}%;background:${stallColor}"></i></div>
      <span>${stallFrac >= 1 ? 'Recovering…' : `auto-recover after ${f.stallMinutes}m without credit`}</span>
    </div>`,
  );
}

// ------------------------------------------------------------------ stats

function renderStats() {
  const f = farm();
  if (!f) return setHTML($('#stats'), [1, 2, 3, 4, 5, 6].map(() => '<div class="card stat skeleton" style="height:96px"></div>').join(''));
  const s = f.stats;
  const watchedMin = s.watchMs / MIN;
  const efficiency = watchedMin > 1 ? Math.min(100, Math.round((s.earned / watchedMin) * 100)) : null;
  const primary = primaryCampaign();
  const fc = primary ? f.forecast[primary.id] : null;
  const tracked = f.categories.flatMap(trackedRewards);
  const claimedAll = tracked.filter((r) => r.claimed).length;
  const p = f.player ?? {};
  const health = streamHealth(f);
  // On a narrow card, "540p · window muted" keeps the resolution.
  const player = health ? [health.label, health.tone, esc(health.foot).replace(' · window muted', '<span class="opt"> · window muted</span>')] : ['Idle', '', 'nothing playing'];
  const nextEvent = p.lastEventAt ? p.lastEventAt + 120_000 - Date.now() : null;
  const conflictTone = f.eventsSinceCredit >= 3 ? 'bad' : f.eventsSinceCredit >= 2 ? 'warn' : '';

  const card = (iconName, tone, label, value, foot, extra = '') => `<div class="card stat">
    <div class="stat-head"><span class="stat-icon ${tone}">${icon(iconName)}</span>${label}</div>
    <div class="stat-value">${value}</div>
    <div class="stat-foot"><span>${foot}</span>${extra}</div></div>`;

  setHTML(
    $('#stats'),
    [
      card('clock', 'teal', 'Watch time', fmtDur(s.watchMs), `since ${fmtClock(s.sessionStart)}`),
      card(
        'bolt',
        'green',
        'Credited',
        `${s.earned}<small>min</small>`,
        efficiency === null ? 'measuring…' : `<span class="${efficiency >= 80 ? 'delta-up' : 'delta-down'}">${efficiency}%</span> efficient`,
        sparkBars(creditBuckets(), { width: 64, height: 24 }),
      ),
      card('pulse', 'blue', 'Credit rate', fc ? `${fc.rate.toFixed(2)}<small>×</small>` : '—', fc?.observed ? 'measured<span class="opt">, last 30 min</span>' : 'estimated'),
      card('gift', 'gold', 'Claimed', `${s.claimsToday ?? s.claims}<small>today</small>`, `${claimedAll} of ${tracked.length} collected`),
      card(
        'users',
        'violet',
        'Watch events',
        `${s.eventsSent}<small>sent</small>`,
        !f.current ? 'none while idle' : nextEvent === null ? 'first one soon' : nextEvent > 0 ? `next in ${fmtDur(nextEvent)}` : 'next due now',
        f.eventsSinceCredit >= 2 ? `<span class="chip ${conflictTone === 'bad' ? 'red' : 'amber'}">${f.eventsSinceCredit} uncredited</span>` : '',
      ),
      card('eye', player[1] === 'good' ? 'green' : player[1] === 'bad' ? 'red' : 'amber', 'Player', `<span class="player-state ${player[1]}">${player[1] === 'good' ? '<span class="live-dot green"></span>' : ''}${player[0]}</span>`, player[2]),
    ].join(''),
  );
}

// ------------------------------------------------------------------ chart + live monitor

// The chart and live monitor redraw when their data changes, and otherwise every
// 15 s for the moving time axis: not on every one-second tick.
let chartStamp = '';

/**
 * What the chart shows with nothing playing. Paused with a channel live to go back to, the
 * campaigns Pear Drops would farm on resuming. Otherwise a scene: a radar over the categories
 * still to go, or the rewards collected once there's nothing left.
 */
function idleChart(f) {
  const left = f.categories.filter((c) => c.enabled && c.needsWatching && !c.complete);
  if (f.paused) {
    const live = left.find((c) => c.streamCount > 0);
    if (live) return { resume: live.campaigns.filter((c) => c.needsWatching) };
  }
  if (!left.length) {
    const collected = f.categories.flatMap(trackedRewards).filter((r) => r.claimed);
    return { mode: 'done', items: collected.map((r) => ({ name: r.name, image: r.image })), sub: 'Nothing left to farm' };
  }
  const items = left.map((c) => ({ name: c.name, image: c.image }));
  if (f.paused) return { mode: 'paused', items, sub: 'None of the remaining drops’ channels are live' };
  if (f.status.code === 'error') return { mode: 'scan', tone: 'warn', items, sub: 'Waiting for Kick to answer' };
  return { mode: 'scan', items, sub: `Looking for a live channel in ${left.length} ${left.length === 1 ? 'category' : 'categories'}` };
}

function renderChart() {
  const f = farm();
  const el = $('#chart');
  const idle = f && !f.current ? idleChart(f) : null;
  const stamp = f
    ? [ui.chartCampaign, f.current?.slug, f.paused, f.status.code, f.checkedAt, f.samples.length, f.timeline.length, f.samples.at(-1)?.t, Math.floor(Date.now() / 15000), el.clientWidth, el.clientHeight].join('|')
    : '';
  if (f && stamp === chartStamp) return;
  chartStamp = stamp;
  if (!f) return setHTML(el, '<div class="card-body"><div class="skeleton" style="height:100%"></div></div>');
  const now = Date.now();
  const checks = f.timeline.some((e) => e.type === 'check' && e.t > now - 60 * MIN);
  // With nothing playing, the monitor says what it's showing instead.
  const quiet = !idle ? '' : f.paused ? 'Paused · watch events start again when you resume' : idle.mode === 'done' ? 'Each check for new campaigns shows here' : 'Each check for a live channel shows here';
  const monitor = `<div class="monitor">
      <div class="monitor-head"><span class="card-title">${icon('pulse')} Live monitor</span>
        <div class="legend">
          <span><i style="background:rgba(255,255,255,.5)"></i>Watch event</span>
          <span><i style="background:var(--green)"></i>Credit</span>
          <span><i style="background:var(--blue)"></i>Switch</span>
          <span><i style="background:var(--gold);border-radius:50%"></i>Claim</span>
          ${checks ? '<span><i class="legend-check"></i>Check</span>' : ''}
        </div><span class="card-sub">last 60 min</span></div>
      ${heartbeatStrip(f.timeline, now, { width: widthOf(el, 600) - 36, height: 78, idle: quiet })}
    </div>`;
  const wrap = el.querySelector('.chart-wrap');
  const height = Math.max(140, Math.round((wrap?.clientHeight || 270) - 12));
  const width = Math.max(240, Math.round((wrap?.clientWidth || 720) - 12));
  const head = (sub, tabs = '') => `<div class="card-head">
      <div class="card-title">${icon('target')} Progress &amp; forecast</div>
      <span class="card-sub">${sub}</span>
      <div class="spacer"></div>${tabs}
    </div>`;
  if (idle && !idle.resume) {
    return setHTML(el, `${head(esc(idle.sub))}<div class="chart-wrap">${idleScene({ ...idle, width, height, checkedAt: f.checkedAt, now })}</div>${monitor}`);
  }
  const candidates = idle?.resume ?? currentCampaigns();
  if (!candidates.some((c) => c.id === ui.chartCampaign)) ui.chartCampaign = (primaryCampaign() ?? candidates[0]).id;
  const camp = candidates.find((c) => c.id === ui.chartCampaign);
  const fc = f.forecast[camp.id];
  const points = f.samples.filter((s) => s.units[camp.id] !== undefined).map((s) => [s.t, s.units[camp.id]]);
  if (!points.length) points.push([now, camp.units]);
  const tabs =
    candidates.length > 1
      ? `<div class="tabs">${candidates.map((c) => `<button class="tab ${c.id === camp.id ? 'active' : ''}" data-action="chart-campaign" data-id="${esc(c.id)}">${esc(c.name)}</button>`).join('')}</div>`
      : '';
  const sub = idle ? `${esc(camp.name)} · ${camp.units}/${camp.targetUnits} min · ${fmtMin(fc?.doneMinutes)} to go once you resume` : `${esc(camp.name)} · ${camp.units}/${camp.targetUnits} min · done ${fmtEta(fc?.doneMinutes)}`;
  setHTML(
    el,
    `${head(sub, tabs)}
    <div class="chart-wrap">${progressChart({ points, rewards: camp.rewards, target: camp.targetUnits, now, rate: fc?.rate ?? 1, resume: !!idle, width, height })}</div>
    ${monitor}`,
  );
}

// ------------------------------------------------------------------ side panel: queue, streams, activity

function catStatus(cat, f) {
  if (!cat.enabled) return '<span class="chip">Disabled</span>';
  if (cat.complete) return `<span class="chip green">${icon('check')} Done</span>`;
  if (cat.urgent && cat.enabled && !cat.complete) {
    const h = Math.max(1, Math.round(cat.urgent.msLeft / 3600_000));
    return `<span class="chip red" data-tip="Ends in ~${h}h and needs ~${fmtMin(cat.urgent.remaining)} more: moved to the top">${icon('bolt')} Ends soon</span>`;
  }
  if (f.current?.categoryId === cat.id) return '<span class="chip green"><span class="live-dot green"></span>Farming</span>';
  if (!cat.needsWatching) return `<span class="chip amber">${icon('gift')} Claimable</span>`;
  if (cat.streamsLoaded && !cat.streamCount) return '<span class="chip amber" data-tip="No eligible channel is live">Offline</span>';
  return '<span class="chip blue">Next</span>';
}

/** A category that rarely has a stream on (farmer.js liveRate): Smart order catches it while it's live. */
function rareChip(cat) {
  if (!cat.rarelyLive || cat.complete || !cat.needsWatching) return '';
  const smart = state.settings.queueMode === 'smart';
  // Under a week watched, say how few hours that is, rather than a percentage of "this week".
  const { hours, live, since } = cat.liveSeen ?? {};
  const seen =
    since > Date.now() - 6 * 24 * 3600_000
      ? `Live ${live} of ${hours} hours seen since ${new Date(since).toLocaleDateString([], { weekday: 'short' })} ${fmtClock(since)}.`
      : `Live ${Math.round(cat.liveRate * 100)}% of the hours seen this week.`;
  return `<span class="chip violet" data-tip="${seen}\n${smart ? 'Smart order watches it while it’s on.' : 'Smart order would watch it while it’s on.'}">Rare</span>`;
}

/** A thin bar of minutes watched, with each reward's icon at the minute it unlocks. */
function unitsTrack(name, units, rewards, { note = '', ended = false } = {}) {
  const tracked = rewards.filter((r) => r.tracked);
  const max = Math.max(1, ...tracked.map((r) => r.required));
  const fill = Math.min(1, units / max);
  const tip = `${name}: ${Math.min(units, max)} of ${max} min watched${note}`;
  const marks = tracked
    .map((r) => `<span class="track-mark ${r.claimed ? 'claimed' : r.ready ? 'ready' : ended ? 'missed' : ''}" style="left:${((r.required / max) * 100).toFixed(1)}%" ${previewAttrs(r, units, ended && !r.claimed)}>${img(r.image)}</span>`)
    .join('');
  return `<div class="track compact" data-tip="${esc(tip)}"><div class="track-fill" style="width:${(fill * 100).toFixed(1)}%"></div>${marks}</div>`;
}

/** A queue row's bar: the category's lead drop (being watched, else next to watch). */
function catTrack(cat) {
  const lead = cat.campaigns.find((c) => c.watching) ?? cat.campaigns.find((c) => c.needsWatching) ?? cat.campaigns[0];
  if (!lead) return '';
  const others = cat.campaigns.filter((c) => c !== lead && c.needsWatching).length;
  return unitsTrack(lead.name, lead.units, lead.rewards, { note: others ? ` (+${others} more drop${others > 1 ? 's' : ''} here)` : '' });
}

function campaignTrack(c) {
  const max = Math.max(1, ...c.rewards.map((r) => r.required));
  const fill = Math.min(1, c.units / max);
  const marks = c.rewards
    .map((r) => {
      const left = (r.required / max) * 100;
      const cls = r.claimed ? 'claimed' : r.ready ? 'ready' : r.tracked ? '' : 'game';
      return `<span class="track-mark ${cls}" style="left:${left}%" ${previewAttrs(r, c.units)}>${img(r.image)}</span>`;
    })
    .join('');
  return `<div class="track"><div class="track-fill" style="width:${(fill * 100).toFixed(1)}%"></div>${marks}</div>`;
}

function queuePanel(f) {
  // Finished categories live in the Done tab.
  const cats = f.categories.filter((c) => !c.complete);
  const smart = state.settings.queueMode === 'smart';
  const sortable = cats.filter((c) => !c.complete);
  const rows = cats
    .map((cat, i) => {
      const locked = cat.complete;
      const fixed = locked || smart; // no dragging or arrows
      const pos = sortable.indexOf(cat);
      const rewards = trackedRewards(cat);
      const claimed = rewards.filter((r) => r.claimed).length;
      const open = ui.expanded.has(cat.id);
      const isCurrent = f.current?.categoryId === cat.id;
      const ends = Math.min(...cat.campaigns.map((c) => new Date(c.endsAt).getTime()));
      const eta = categoryEta(cat);
      const meta = [
        cat.needsWatching && cat.enabled && cat.streamCount ? `${icon('users')} ${cat.streamCount}${cat.streamCount >= 100 ? '+' : ''} live` : '',
        `${icon('clock')} ${fmtEnds(new Date(ends).toISOString())}`,
        // (claimed rewards show as filled icons on the bar)
        claimed && claimed < rewards.length ? `${claimed}/${rewards.length} claimed` : '',
      ].filter(Boolean);
      const finished = cat.campaigns.filter((c) => c.complete).length;
      const campaigns = open
        ? `<div class="cat-campaigns">${cat.campaigns
            .filter((c) => !c.complete)
            .map((c) => {
              const fc = f.forecast[c.id];
              const ready = c.rewards.filter((r) => r.ready && r.tracked);
              return `<div class="campaign">
                <div class="campaign-head">
                  <span class="campaign-name">${esc(c.name)}</span>
                  <button class="btn sm hist-btn" data-action="hist-campaign" data-id="${esc(c.id)}" data-tip="This drop's history">${icon('list')} History</button>${detailsButton(c.url)}
                  ${c.watching ? '<span class="chip green">Watching</span>' : ''}
                  <span class="chip flat">${c.channels.length ? `${c.channels.length} channel${c.channels.length > 1 ? 's' : ''}` : 'any channel'} · ${esc(c.org ?? '')}</span>
                  <div class="spacer"></div>
                  <span class="card-sub num">${c.units}/${c.targetUnits || '—'}m${fc && c.needsWatching ? ` · ${fmtMin(fc.doneMinutes)} left` : ''}</span>
                </div>
                ${campaignTrack(c)}
                <div class="campaign-rewards">${c.rewards
                  .map(
                    (r) =>
                      `<span class="mini-reward ${r.claimed ? 'claimed' : r.ready ? 'ready' : r.tracked ? '' : 'game'}" ${previewAttrs(r, c.units)}>${img(r.image)}${esc(r.name)} <em>${r.required}m</em>${
                        r.ready && r.tracked ? ` <button class="btn sm primary" data-action="claim" data-campaign="${esc(c.id)}" data-reward="${esc(r.id)}">${r.claimError ? 'Try again' : 'Claim'}</button>` : ''
                      }${r.tracked ? claimErrorHTML(r) : ''}</span>`,
                  )
                  .join('')}</div>
                ${ready.length ? '' : ''}
              </div>`;
            })
            .join('')}${finished ? `<button class="link small cat-finished" data-action="side-tab" data-id="done">${icon('check')} ${finished} finished drop${finished > 1 ? 's' : ''} in Done</button>` : ''}</div>`
        : '';
      return `<div class="cat ${isCurrent ? 'current' : ''} ${cat.enabled ? '' : 'disabled'} ${locked ? 'complete locked' : ''} ${smart && !locked ? 'smart' : ''}" ${fixed ? '' : 'data-reorder'} data-cat-id="${cat.id}">
        <div class="cat-row" data-action="expand" data-id="${cat.id}">
          ${locked ? `<span class="cat-grip done" data-tip="Complete">${icon('check')}</span>` : smart ? `<span class="cat-grip" data-tip="Smart order sorts this automatically. Switch to Manual to rearrange.">${icon('lock')}<span class="cat-rank">${i + 1}</span></span>` : `<span class="cat-grip" data-tip="Drag to reorder">${icon('grip')}<span class="cat-rank">${i + 1}</span></span>`}
          ${img(cat.image, 'cat-art', cat.name)}
          <div class="cat-info">
            <div class="cat-name"><span>${esc(cat.name)}</span>${catStatus(cat, f)}${rareChip(cat)}</div>
            <div class="cat-meta">${meta.map((m) => `<span>${m}</span>`).join('<i>·</i>')}</div>
            ${catTrack(cat)}
          </div>
          <div class="cat-side">
            <div class="cat-stats">${cat.needsWatching ? `<b>${fmtMin(eta)}</b><span>left</span>` : locked ? `<b style="color:var(--green)">Done</b><span>collected</span>` : `<b>0m</b><span>claiming</span>`}</div>
            ${
              fixed
                ? ''
                : `<span class="cat-arrows">
              <button class="btn sm icon-only ghost" data-action="cat-up" data-id="${cat.id}" data-tip="Move up" ${pos === 0 ? 'disabled' : ''}>${icon('up')}</button>
              <button class="btn sm icon-only ghost" data-action="cat-down" data-id="${cat.id}" data-tip="Move down" ${pos === sortable.length - 1 ? 'disabled' : ''}>${icon('down')}</button>
            </span>`
            }
          </div>
          <div class="cat-controls">
            ${locked ? '' : `<button class="switch soft ${cat.enabled ? 'on' : ''}" data-action="cat-toggle" data-id="${cat.id}" data-tip="${cat.enabled ? 'Farming this category' : 'Skipping this category'}"></button>`}
          </div>
        </div>
        ${campaigns}
      </div>`;
    })
    .join('');
  // A sliding switch between the two orders; the thumb glows green for Smart.
  const toggle = `<div class="mode-switch queue-mode ${smart ? 'smart' : 'manual'}">
      <span class="mode-thumb"></span>
      <button class="mode-opt ${smart ? 'active' : ''}" data-action="queue-mode" data-id="smart" data-tip="Order by which drops expire first, automatically">${icon('bolt')}<span>Smart</span></button>
      <button class="mode-opt ${smart ? '' : 'active'}" data-action="queue-mode" data-id="manual" data-tip="Your own order (drag to arrange)">${icon('grip')}<span>Manual</span></button>
    </div>`;
  const note = smart ? '<b>Running out first.</b> Rare drops while they’re live.' : '<b>Your order.</b> Drag to rearrange.';
  const toGo = cats.flatMap(trackedRewards).filter((r) => !r.claimed).length;
  return `<div class="panel-head">${toggle}<p class="panel-note">${note}<br /><span>${toGo ? `${toGo} reward${toGo > 1 ? 's' : ''} to go · ` : ''}click a category for its drops.</span></p></div>
    <div class="queue-list">${rows || `<div class="empty">${icon('gift')}${f.categories.length ? 'Every drop is collected. Finished ones are in Done.' : 'No active emote or badge drops right now.'}</div>`}</div>
    ${comingCard(f)}`;
}

// Coming soon: how long each announced drop shows before the next, unless one was picked.
const COMING_EVERY_MS = 30_000;

/** How long ago, roughly: "40 min ago", "5 hours ago", "2 days ago". */
function fmtSince(t) {
  const m = Math.max(0, (Date.now() - t) / MIN);
  if (m < 60) return m < 2 ? 'just now' : `${Math.round(m)} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

/** A drop's About page (an event, a category or the publisher's site), as a Details button. */
function detailsButton(url) {
  if (!url) return '';
  let host = '';
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {}
  return `<button class="btn sm hist-btn" data-action="open-link" data-url="${esc(url)}" data-tip="${esc(host ? `Opens ${host}` : 'More about this drop')}">${icon('external')} Details</button>`;
}

/** Why Kick refused a reward's claim, with a button to link the game account if that's it. */
function claimErrorHTML(r) {
  const e = r.claimError;
  if (!e) return '';
  return `<span class="claim-error" data-tip="${esc(e.text)}">${icon('alert')} Couldn’t claim</span>${
    e.connectUrl ? `<button class="btn sm" data-action="open-link" data-url="${esc(e.connectUrl)}">${icon('external')} Link your account</button>` : ''
  }`;
}

/**
 * Drops Kick has announced but not started, at the foot of the Queue: one at a time, the next
 * every 30 seconds (not while the pointer is on it), with dots to pick one.
 */
function comingCard(f) {
  const list = f.upcoming ?? [];
  if (!list.length) return '';
  const now = Date.now();
  if (ui.comingIdx === undefined || ui.comingIdx >= list.length) ui.comingIdx = 0;
  if (!ui.comingHover && list.length > 1 && now - (ui.comingAt ?? now) >= COMING_EVERY_MS) ui.comingIdx = (ui.comingIdx + 1) % list.length;
  if (ui.comingAt === undefined || ui.comingShown !== ui.comingIdx) {
    ui.comingAt = now;
    ui.comingShown = ui.comingIdx;
  }
  const c = list[ui.comingIdx];
  const starts = new Date(c.startsAt).getTime();
  const when = new Date(starts).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const dots =
    list.length > 1
      ? `<span class="coming-dots">${list.map((x, i) => `<button class="coming-dot ${i === ui.comingIdx ? 'on' : ''}" data-action="coming-pick" data-id="${i}" data-tip="${esc(x.name)}"></button>`).join('')}</span>`
      : '';
  return `<div class="coming" data-key="coming-${esc(c.id)}">
    <div class="coming-head"><span class="eyebrow">Coming soon</span>${list.length > 1 ? `<span class="card-sub">${ui.comingIdx + 1} of ${list.length}</span>` : ''}<span class="spacer"></span>${dots}${detailsButton(c.url)}</div>
    <div class="coming-body">
      ${img(c.image, 'coming-art', c.category)}
      <div class="coming-info">
        <b>${esc(c.name)}</b>
        <span class="coming-when">${esc(c.category)} · starts ${when} · in ${fmtDur(starts - now)}${c.announcedAt ? ` · announced ${fmtSince(new Date(c.announcedAt).getTime())}` : ''}</span>
        <div class="coming-rewards">${c.rewards.map((r) => `<span class="mini-reward" ${previewAttrs(r, 0)}>${img(r.image)}${esc(r.name)} <em>${r.required}m</em></span>`).join('')}</div>
      </div>
    </div>
  </div>`;
}

const fmtDate = (t) => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });

/** Finished and missed drops, kept after Kick removes them. */
function donePanel(f) {
  const past = f.past ?? [];
  const counts = { all: past.length, completed: past.filter((p) => p.status === 'completed').length, missed: past.filter((p) => p.status === 'missed').length };
  const list = ui.pastFilter === 'all' ? past : past.filter((p) => p.status === ui.pastFilter);
  const filters = [
    ['all', 'All'],
    ['completed', 'Completed'],
    ['missed', 'Missed'],
  ]
    .map(([id, label]) => `<button class="tab ${ui.pastFilter === id ? 'active' : ''}" data-action="past-filter" data-id="${id}">${label} <em>${counts[id]}</em></button>`)
    .join('');
  const rows = list
    .map((p) => {
      const done = p.status === 'completed';
      const ended = new Date(p.endsAt).getTime() <= Date.now() || !p.onKick;
      const when = done
        ? p.at
          ? `Completed ${fmtDate(p.at)}`
          : 'Completed'
        : p.partial
          ? `Last watched ${fmtDate(p.at)}`
          : p.removed
            ? `Taken down ${fmtDate(p.at)}`
            : `Ended ${fmtDate(p.at)}`;
      const chip = done
        ? `<span class="chip green">${icon('check')} Completed</span>`
        : p.partial
          ? `<span class="chip red" data-tip="Ended without every reward claimed">Missed</span>`
          : `<span class="chip ${p.claimed ? 'amber' : 'red'}" data-tip="${p.claimed ? `${p.total - p.claimed} reward${p.total - p.claimed > 1 ? 's' : ''} left unclaimed` : 'Ended before any reward was earned'}">${p.claimed ? `${p.claimed}/${p.total} claimed` : 'Missed'}</span>`;
      // A finished drop can still be running on Kick for others: say so plainly.
      const meta = [esc(p.category ?? ''), when, done && p.onKick && !ended ? `still live, ${fmtEnds(p.endsAt)}` : ''].filter(Boolean);
      const rewards = p.rewards
        .filter((r) => r.tracked)
        .map((r) => `<span class="mini-reward ${r.claimed ? 'claimed' : 'missed'}" ${previewAttrs(r, p.units, !r.claimed && ended)}>${img(r.image)}${esc(r.name)} <em>${r.claimed ? icon('check') : `${r.required}m`}</em></span>`)
        .join('');
      return `<div class="past ${done ? 'completed' : 'missed'}" data-past-id="${esc(p.id)}">
        <div class="past-row">
          ${img(p.image, 'cat-art', p.category ?? '')}
          <div class="cat-info">
            <div class="cat-name"><span>${esc(p.name)}</span>${chip}</div>
            <div class="cat-meta">${meta.map((m) => `<span>${m}</span>`).join('<i>·</i>')}</div>
            ${p.partial ? `<div class="past-partial" data-tip="Kick removed this drop before this version of the app could save its details">${icon('list')} From your history: ${p.units ? `${p.units} min credited` : 'watched, nothing credited'}</div>` : unitsTrack(p.name, p.units, p.rewards, { ended })}
          </div>
          <div class="past-actions"><button class="btn sm hist-btn" data-action="hist-campaign" data-id="${esc(p.id)}" data-tip="This drop's history">${icon('list')} History</button>${detailsButton(p.url)}</div>
        </div>
        ${rewards ? `<div class="campaign-rewards">${rewards}</div>` : ''}
      </div>`;
    })
    .join('');
  const empty = {
    all: 'Finished drops show here, and stay after Kick removes them.',
    completed: 'No finished drops yet.',
    missed: 'Nothing missed. Drops that end with rewards left show here.',
  }[ui.pastFilter];
  return `<div class="panel-head"><div class="tabs">${filters}</div><p class="panel-note">Saved on this computer with their artwork, so they stay after Kick removes them.</p></div>
    <div class="queue-list">${rows || `<div class="empty">${icon('trophy')}${empty}</div>`}</div>`;
}

function streamsPanel(f) {
  const cats = f.categories.filter((c) => c.needsWatching && c.enabled);
  if (!cats.some((c) => c.id === ui.selectedCategory)) ui.selectedCategory = f.current?.categoryId ?? cats[0]?.id ?? null;
  const cat = cats.find((c) => c.id === ui.selectedCategory);
  const tabs = cats.map((c) => `<button class="tab ${c.id === ui.selectedCategory ? 'active' : ''}" data-action="select-cat" data-id="${c.id}"${c.name.length > 24 ? ` data-tip="${esc(c.name)}"` : ''}><span class="tab-name">${esc(c.name)}</span><em>${c.streamCount}</em></button>`).join('');
  if (!cat) return `<div class="empty">${icon('users')}No categories need watching.</div>`;
  const followed = cat.streams.filter((s) => s.followed);
  const others = cat.streams.filter((s) => !s.followed);
  const row = (s) => {
    const isCurrent = f.current?.slug === s.slug;
    return `<div class="stream ${isCurrent ? 'current' : ''} ${s.blocked ? 'blocked' : ''}">
      <div class="thumb">${img(s.thumbnail)}<span class="viewers num">${fmtCount(s.viewers)}</span></div>
      <div class="stream-info">
        <div class="stream-name">${img(s.avatar, 'avatar sm')}${esc(s.username)} ${s.followed ? icon('heart') : ''}
          ${s.covers.length > 1 ? `<span class="chip green">${s.covers.length} drops</span>` : ''}${s.mature ? '<span class="chip pink">18+</span>' : ''}${s.blocked ? '<span class="chip amber">Skipped</span>' : ''}</div>
        <div class="stream-title">${esc(s.title)}</div>
      </div>
      ${isCurrent ? '<span class="chip green"><span class="live-dot green"></span>Watching</span>' : `<button class="btn sm" data-action="watch" data-slug="${esc(s.slug)}" data-cat="${cat.id}">${icon('play')} Watch</button>`}
    </div>`;
  };
  const group = (label, iconName, items) => (items.length ? `<div class="stream-group">${icon(iconName)}<span class="eyebrow">${label} · ${items.length}</span><span class="line"></span></div>${items.map(row).join('')}` : '');
  const list = cat.streams.length
    ? `${group('Following', 'heart', followed)}${group('Live now', 'eye', others)}`
    : `<div class="empty">${icon('clock')}${cat.streamsLoaded ? 'No eligible channels are live right now.' : 'Loading live streams…'}</div>`;
  // A short list: say how often it's checked, and where else streams are live.
  const elsewhere = cats.filter((c) => c.id !== cat.id && c.streamCount);
  const few =
    cat.streams.length && cat.streams.length <= 3
      ? `<div class="streams-note">${icon('clock')}<div><b>${cat.streams.length === 1 ? 'Only 1 live stream counts' : `${cat.streams.length} live streams count`} for ${esc(cat.name)} right now.</b>
          <span>Pear Drops looks for more every ${state.settings.streamsMinutes ?? 3} min.${elsewhere.length ? ' Also live:' : ''}</span>
          ${elsewhere.length ? `<div class="streams-elsewhere">${elsewhere.map((c) => `<button class="chip" data-action="select-cat" data-id="${c.id}">${img(c.image, 'tiny-img')}${esc(c.name)} <em>${c.streamCount}</em></button>`).join('')}</div>` : ''}</div></div>`
      : '';
  return `<div class="tabs sub-tabs">${tabs}</div><div class="stream-list">${list}</div>${few}`;
}

const LOG_ICON = { credit: 'bolt', claim: 'gift', switch: 'play', warn: 'alert', error: 'alert', alert: 'bell', info: 'pulse' };

/** The log, newest first, with a run of credits on one drop as one line ("+8 min on X · 142 → 148 min"). */
function activityRows(log) {
  const rows = [];
  for (const l of [...log].reverse().slice(0, 300)) {
    const m = l.level === 'credit' && /^\+(\d+) min on (.+) \((\d+) total\)$/.exec(l.text);
    const prev = rows[rows.length - 1];
    if (m && prev?.credit && prev.credit.name === m[2]) {
      prev.credit.delta += Number(m[1]);
      prev.credit.from = Number(m[3]) - Number(m[1]);
      prev.credit.count += 1;
      prev.first = l.t;
      continue;
    }
    rows.push({ ...l, first: l.t, credit: m ? { name: m[2], delta: Number(m[1]), from: Number(m[3]) - Number(m[1]), to: Number(m[3]), count: 1 } : null });
  }
  return rows.slice(0, 150).map((r) =>
    r.credit && r.credit.count > 1 ? { ...r, text: `+${r.credit.delta} min on ${r.credit.name} · ${r.credit.from} → ${r.credit.to} min` } : r,
  );
}

function activityPanel(f) {
  const clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const items = activityRows(f.log)
    .map(
      (l) => `<div class="log-item lv-${l.level}"><span class="log-icon">${icon(LOG_ICON[l.level] ?? 'pulse')}</span>
        <span class="log-text">${esc(l.text)}</span><span class="log-time">${l.first !== l.t ? `${clock(l.first)}–${clock(l.t)}` : clock(l.t)}</span></div>`,
    )
    .join('');
  return `<div class="log">${items || `<div class="empty">${icon('pulse')}Nothing yet.</div>`}</div>`;
}

function renderSide() {
  // Don't rebuild the list under a drag in progress.
  if (ui.drag) return;
  const f = farm();
  const el = $('#side');
  if (!f) return setHTML(el, '<div class="card-body"><div class="skeleton" style="height:100%"></div></div>');
  // What the Queue tab lists: the categories with drops still to collect.
  const queued = f.categories.filter((c) => !c.complete).length;
  const streams = f.categories.find((c) => c.id === (f.current?.categoryId ?? ui.selectedCategory))?.streamCount ?? 0;
  const pastCount = (f.past ?? []).length;
  const tabs = [
    ['queue', 'list', 'Queue', queued ? String(queued) : ''],
    ['done', 'trophy', 'Done', pastCount ? String(pastCount) : ''],
    ['streams', 'eye', 'Streams', streams ? `${streams} live` : ''],
    ['activity', 'pulse', 'Activity', ''],
  ];
  const body = ui.sideTab === 'streams' ? streamsPanel(f) : ui.sideTab === 'activity' ? activityPanel(f) : ui.sideTab === 'done' ? donePanel(f) : queuePanel(f);
  setHTML(
    el,
    `<div class="side-tabs">${tabs
      .map(([id, ic, label, badge]) => `<button class="side-tab ${ui.sideTab === id ? 'active' : ''}" data-action="side-tab" data-id="${id}">${icon(ic)}${label}${badge ? `<em>${badge}</em>` : ''}</button>`)
      .join('')}</div>
    <div class="side-body" data-tab="${ui.sideTab}">${body}</div>`,
  );
}

// ------------------------------------------------------------------ player panel

const mirrorShowsChat = () => state.settings.playerMode !== 'full' && state.settings.showChat !== false;

function renderPlayer() {
  const f = farm();
  const cur = f?.current;
  $('.layout').classList.toggle('player-collapsed', !ui.playerOpen);
  // Light shows the player at 16:9 with the chat below it (see watcher.js applyBounds).
  $('#player-slot').classList.toggle('light', state.settings.playerMode !== 'full');
  if (!cur) $('#player-mirror').hidden = true;
  if (!cur || !mirrorShowsChat()) $('#chat-mirror').hidden = true;
  const collapse = `<button class="btn sm icon-only ghost collapse-btn" data-action="toggle-player" data-tip="${ui.playerOpen ? 'Hide stream' : 'Show stream'}">${icon(ui.playerOpen ? 'chevronRight' : 'chevronLeft')}</button>`;
  setHTML(
    $('#player-head'),
    ui.playerOpen
      ? cur
        ? `${img(cur.avatar, 'avatar')}<div class="who"><b>${esc(cur.username)} <span class="live-dot"></span></b><span>${esc(cur.categoryName)} · ${fmtCount(cur.viewers)} watching</span></div>
           ${followButton(cur)}
           <button class="btn sm icon-only ghost" data-action="open-kick" data-slug="${esc(cur.slug)}" data-tip="Open on kick.com">${icon('external')}</button>${collapse}`
        : `<div class="who"><b>Stream</b><span>Nothing playing</span></div>${collapse}`
      : `${collapse}<span class="rail-label">${cur ? esc(cur.username) : 'Stream'}</span>`,
  );
  setHTML(
    $('#player-empty'),
    `<div>${icon('panel')}<div style="font-weight:650;color:var(--text-2);margin-bottom:4px">${f?.paused ? 'Paused' : 'No stream yet'}</div><div>The stream and its chat appear here while a drop is being farmed.</div></div>`,
  );
  setHTML(
    $('#player-foot'),
    `${icon('volumeOff')}<span>Window muted</span><span class="spacer"></span><span>${cur ? `Kick's player · ${f.player?.eventsSent ?? 0} events` : ''}</span>`,
  );
  syncPlayerBounds();
}

/** Follow / Following on the player header. Hovering Following offers Unfollow. */
function followButton(cur) {
  const busy = ui.followBusy === cur.slug;
  if (cur.followed)
    return `<button class="follow-btn following ${busy ? 'busy' : ''}" data-action="follow" data-slug="${esc(cur.slug)}" data-on="" data-tip="Unfollow ${esc(cur.username)} on Kick" ${busy ? 'disabled' : ''}>
      ${icon('heart')}<span class="f-on">Following</span><span class="f-off">Unfollow</span></button>`;
  return `<button class="follow-btn ${busy ? 'busy' : ''}" data-action="follow" data-slug="${esc(cur.slug)}" data-on="1" data-tip="Follow ${esc(cur.username)} on Kick. Channels you follow are watched first" ${busy ? 'disabled' : ''}>
    ${icon('heart')}<span>Follow</span></button>`;
}

let lastBounds = '';
function syncPlayerBounds() {
  const slot = $('#player-slot');
  const visible = ui.playerOpen && !!farm()?.current && !ui.modal && !$('#app').hidden;
  let rect = null;
  if (visible) {
    const r = slot.getBoundingClientRect();
    rect = { x: r.left, y: r.top, width: r.width, height: r.height };
  }
  const key = JSON.stringify(rect);
  if (key === lastBounds) return;
  lastBounds = key;
  window.pd.setPlayerBounds(rect);
}

// ------------------------------------------------------------------ settings modal

// Settings › Notifications: one switch per kind (src/main/notifier.js), all off to start with.
const NOTIFY_KINDS = [
  ['claimed', 'A drop is claimed', 'Each emote or badge, once Kick confirms it.'],
  ['ready', 'A drop is ready to claim', 'When automatic claiming is off, so you can claim it yourself.'],
  ['ended', 'A stream ends or raids', 'The streamer went offline or raided, and the app moved on.'],
  ['trouble', 'A stream has a problem', 'The player froze or failed, and was reloaded or swapped.'],
  ['conflict', 'Credit goes to another stream', 'Kick credits one stream per account: another one is taking it.'],
  ['signedOut', 'You need to sign in again', 'Your Kick login expired, so farming stopped.'],
  ['done', 'All collected, or nothing live', 'Every drop is claimed, or none left has a stream on.'],
  ['newDrops', 'New drops on Kick', 'A campaign with emotes or badges starts.'],
];
const NOTIFY_TEST = {
  sending: 'Sending…',
  shown: 'Shown. Desktop notifications work.',
  unsupported: 'This computer doesn’t support desktop notifications.',
};

const SETTINGS_TABS = [
  ['farming', 'target', 'Farming'],
  ['recovery', 'reload', 'Recovery & alerts'],
  ['notifications', 'bell', 'Notifications'],
  ['refresh', 'refresh', 'Refresh rates'],
  ['app', 'panel', 'App'],
  ['privacy', 'lock', 'Privacy & data'],
  ['account', 'users', 'Account'],
  ['apps', 'link', 'Connected apps'],
  ['updates', 'sparkle', 'Updates'],
];

/**
 * What each Grapevine capability means on a Connected apps card. Any app Grapevine knows gets a tile
 * for each capability it and Pear Drops share (peers().shares): `out` when Pear Drops provides it,
 * `in` when the other app does. `status` gives the card's line while connected, from what the app
 * last sent (heard). A capability that isn't here gets a plain tile with its name.
 */
const CAPABILITIES = {
  'drops.farming': {
    out: ['Pear Drops tells it', 'what you’re farming, so its Kick players can leave the drop credit here, and it can show your progress.'],
  },
  players: {
    in: ['It tells Pear Drops', 'whether its Kick players are signed in right now.'],
    status: (p, name, farming) => {
      const k = p.heard['players.changed']?.platforms?.kick;
      if (!k) return [`Linked. Waiting to hear about ${name}’s players.`, ''];
      if (k.mode === 'signed-in' && farming)
        return [`Its Kick players stay signed in, so they can take your drop credit. In ${name}, turn on <b>Sign Kick players out while Pear Drops is farming</b>.`, 'warn'];
      if (k.mode === 'signed-in') return [`Its Kick players stay signed in. Turn on <b>Sign Kick players out while Pear Drops is farming</b> in ${name} to keep your credit.`, ''];
      if (k.mode === 'signed-out') return ['Its Kick players are always signed out, so your drop credit is safe.', ''];
      return [k.signedIn ? 'Its Kick players are signed in, and sign out as soon as you farm.' : 'Its Kick players are signed out while you farm, so the credit stays here.', ''];
    },
  },
};

/** A linked app with signed-in Kick players open: the likely reason credit goes elsewhere. */
const signedInPlayers = (c) =>
  c?.peers?.find((p) => {
    const k = p.status === 'connected' && p.heard?.['players.changed']?.platforms?.kick;
    return k?.signedIn && k.open?.length;
  });

/**
 * Settings › Connected apps: one card per app Pear Drops can link with (connected.js), with its
 * logo, what it is, where to get it, its Connect switch, what the two apps share, and how it's going.
 */
function connectedPane() {
  const c = state.connected;
  if (act.app) return activityPane(c?.peers?.find((p) => p.id === act.app));
  if (!ui.appIcons) {
    ui.appIcons = {};
    window.pd.connected
      .icons()
      .then((icons) => {
        ui.appIcons = icons;
        render();
      })
      .catch(() => {});
  }
  const farming = farm()?.current;
  const card = (p) => {
    const name = esc(p.name);
    const notInstalled = p.installed === false && p.status !== 'connected';
    const chip = notInstalled
      ? '<span class="chip">Not installed</span>'
      : {
          connected: `<span class="chip green"><span class="live-dot green"></span>Connected${p.version ? ` · ${esc(p.version)}` : ''}</span>`,
          waiting: '<span class="chip amber"><span class="live-dot amber"></span>Waiting</span>',
          'pair-again': '<span class="chip amber">Pair again</span>',
          incompatible: '<span class="chip red">Can’t connect</span>',
          off: '<span class="chip">Off</span>',
        }[p.status];
    // One line on how it's going, and the button that goes with it.
    let line = '';
    let tone = '';
    let action = '';
    if (notInstalled) {
      line = 'Free for Windows, macOS and Linux.';
      action = `<button class="btn sm primary" data-action="open-link" data-url="${esc(p.download)}">${icon('download')} Download</button>`;
    } else if (p.status === 'connected') {
      if (p.report?.state === 'limited') [line, tone] = [esc(p.report.text), 'warn'];
      else [line, tone] = p.shares.in.map((cap) => CAPABILITIES[cap]?.status?.(p, name, farming)).find(Boolean) ?? ['Linked.', ''];
      action = `<button class="btn sm" data-action="connected-disconnect" data-id="${esc(p.id)}">Disconnect</button>`;
    } else if (p.status === 'pair-again') {
      tone = 'warn';
      if (p.keyHeldBy === 'us') {
        line = `The pairing doesn’t match ${name}’s any more (one of the apps was reinstalled, say). Pair again to start afresh.`;
        action = `<button class="btn sm" data-action="connected-pair-again" data-id="${esc(p.id)}">${icon('link')} Pair again</button>`;
      } else line = `The pairing doesn’t match. Press <b>Pair again</b> in ${name}’s Connected apps.`;
    } else if (p.status === 'incompatible') [line, tone] = [esc(p.report?.text ?? 'Can’t connect: update one of the apps.'), 'bad'];
    else if (p.status === 'waiting')
      line =
        p.reason === 'switched-off'
          ? `${name} is open, but its own Connect switch is off.`
          : p.reason === 'disconnected-there'
            ? `Disconnected in ${name}. Switch it on there to link again.`
            : `${name} isn’t open, or its Connect switch is off.`;
    else line = 'Off. Nothing listens until you switch it on.';
    // A tile for each capability the two share: what Pear Drops tells it, and what it tells Pear Drops.
    const tile = (cap, way) => {
      const [title, text] = CAPABILITIES[cap]?.[way] ?? [way === 'out' ? 'Pear Drops tells it' : 'It tells Pear Drops', `“${esc(cap)}”`];
      return `<div class="app-flow ${way}">${icon(way === 'out' ? 'arrowRight' : 'arrowLeft')}<span><b>${title}</b>${text}</span></div>`;
    };
    const flows = [...p.shares.out.map((cap) => tile(cap, 'out')), ...p.shares.in.map((cap) => tile(cap, 'in'))].join('');
    // A Test just run: its answer stands in for the line for a moment, unless the line itself
    // changes meanwhile (a new warning matters more than the test).
    const tested = ui.appTests?.[p.id];
    if (tested?.result && Date.now() - tested.at < 15_000) {
      tested.line ??= line;
      if (tested.line === line) [line, tone] = [esc(tested.result.text), tested.result.ok ? 'ok' : 'warn'];
      else tested.result = null;
    }
    const test = p.enabled
      ? `<button class="btn sm" data-action="connected-test" data-id="${esc(p.id)}" ${tested?.running ? 'disabled' : ''}>${icon('pulse')} ${tested?.running ? 'Testing…' : 'Test'}</button>`
      : '';
    // Every message between the two this run (activity.js).
    const activity = p.enabled ? `<button class="btn sm" data-action="act-open-app" data-id="${esc(p.id)}">${icon('list')} Activity</button>` : '';
    const paired = p.pairedAt ? `<span class="app-paired">Paired ${new Date(p.pairedAt).toLocaleDateString([], { day: 'numeric', month: 'short' })}</span>` : '';
    return `<div class="app-card ${p.status}">
      <div class="app-head">
        ${ui.appIcons?.[p.id] ? `<img class="app-logo" src="${ui.appIcons[p.id]}" alt="" />` : '<span class="app-logo"></span>'}
        <div class="app-info"><b>${name}</b><span>${esc(p.summary)}</span>
          ${notInstalled ? '' : `<button class="app-link" data-action="open-link" data-url="${esc(p.download)}">${icon('external')} Download page</button>`}</div>
        ${chip}
      </div>
      <button class="app-switch" data-action="connected-toggle" data-id="${esc(p.id)}">
        <span class="text"><b>Connect with ${name}</b><span>Both apps need this switched on.</span></span>
        <span class="switch ${p.enabled ? 'on' : ''}"></span>
      </button>
      ${flows ? `<div class="app-flows">${flows}</div>` : ''}
      <div class="app-foot ${tone}"><span class="app-line">${line}</span>${paired}${activity}${test}${action}</div>
    </div>`;
  };
  const error = c?.error ? `<div class="security-row off">${icon('alert')} ${esc(c.error)}</div>` : '';
  return `<p class="pane-note">Apps that work with Pear Drops. They talk directly on this computer; nothing goes online.</p>${error}${(c?.peers ?? []).map(card).join('')}`;
}

/**
 * Settings › Privacy & data: how often the app's data is backed up (backups.js), how many copies
 * are kept, and the last one, with Back up now and the folder.
 */
function backupRows(row, seg) {
  const b = state.backups;
  if (!b) return '';
  const key = (k, html) => html.replace(/data-action="setting-value"/g, `data-action="setting-value" data-key="${k}"`);
  const when = (t) => {
    const d = new Date(t);
    const day = d.toDateString() === new Date().toDateString() ? 'today' : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
    return `${day} at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };
  const mb = (bytes) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
  const status = !b.possible
    ? '<span class="backup-status bad">The data folder can’t be written to, so nothing is saved or backed up this run.</span>'
    : b.running
      ? '<span class="backup-status">Backing up…</span>'
      : b.error
        ? `<span class="backup-status bad">The last try failed: ${esc(b.error)}</span>`
        : b.last
          ? `<span class="backup-status">Last one ${when(b.last.at)}. ${b.count} ${b.count === 1 ? 'copy' : 'copies'}, ${mb(b.size)} in all.</span>`
          : '<span class="backup-status">None yet.</span>';
  return `
    ${row('Back up my data', 'A copy of your history and drop archive, in the data folder. If the data is ever damaged, the app puts the newest good copy back by itself.', key('backupEvery', seg('setting-value', b.every, [['day', 'Daily'], ['week', 'Weekly'], ['off', 'Off']])))}
    ${b.every === 'off' ? '' : row('Copies to keep', 'The oldest is removed when a new one is made.', key('backupKeep', seg('setting-value', String(b.keep), [['3', '3'], ['7', '7'], ['14', '14']])))}
    ${row('Backups', status, `<button class="btn sm" data-action="backup-now" ${b.running || !b.possible ? 'disabled' : ''}>${icon('database')} Back up now</button><button class="btn sm" data-action="backup-show">${icon('folder')} Show</button>`)}`;
}

function renderModal() {
  const root = $('#modal-root');
  if (ui.modal === 'whatsnew') return setHTML(root, whatsNewModal());
  if (ui.modal !== 'settings') return setHTML(root, '');
  const s = state.settings;
  const user = state.auth.user;
  const enc = state.security?.encryption;
  const mac = navigator.platform.startsWith('Mac');
  const tray = mac ? 'menu bar' : 'tray';
  ui.settingsTab ??= 'farming';
  const toggle = (key, on) => `<button class="switch ${on ? 'on' : ''}" data-action="setting-toggle" data-key="${key}"></button>`;
  const row = (title, sub, control) => `<div class="setting"><div class="text"><b>${title}</b><span>${sub}</span></div>${control}</div>`;
  const range = (key, min, max, step, unit) =>
    `<div class="range"><input type="range" min="${min}" max="${max}" step="${step}" value="${s[key]}" data-setting="${key}" data-unit="${unit}" /><output>${s[key]} ${unit}</output></div>`;
  const seg = (action, value, options) => `<div class="tabs">${options.map(([v, label]) => `<button class="tab ${value === v ? 'active' : ''}" data-action="${action}" data-id="${v}">${label}</button>`).join('')}</div>`;

  const panes = {
    farming: `
      ${row('Queue order', 'Smart watches whatever is running out of time first, catches drops that are rarely live while they’re on, and re-sorts as streams go offline and come back. Manual keeps your own drag order.', seg('queue-mode', s.queueMode === 'smart' ? 'smart' : 'manual', [['smart', 'Smart'], ['manual', 'Manual']]))}
      ${s.queueMode === 'smart' ? row('Favour rarely live drops', 'How much Smart order moves up a drop whose category seldom has a stream on, so it’s watched while it’s live. Off sorts by end time alone.', seg('setting-value', ['off', 'some', 'strong'].includes(s.smartRarity) ? s.smartRarity : 'strong', [['off', 'Off'], ['some', 'Some'], ['strong', 'Strong']]).replace(/data-action="setting-value"/g, 'data-action="setting-value" data-key="smartRarity"')) : ''}
      ${s.queueMode === 'smart' ? row('Switch streams for', 'How much sooner another drop must run out of live time before Smart leaves a stream that’s earning.', seg('setting-value', String(s.smartHopMinutes ?? 30), [['15', '15 min'], ['30', '30 min'], ['60', '1 h'], ['120', '2 h']]).replace(/data-action="setting-value"/g, 'data-action="setting-value" data-key="smartHopMinutes"')) : ''}
      ${row('Put drops about to expire first', 'In Manual order, a drop that would run out of time where it sits jumps to the top, as long as its next reward can still be earned.', toggle('prioritizeExpiring', s.prioritizeExpiring))}
      ${row('Claim drops automatically', 'Claim each emote or badge the moment it unlocks.', toggle('autoClaim', s.autoClaim))}
      ${row('Include game drops', 'Also farm rewards that need a linked game account.', toggle('includeGameDrops', s.includeGameDrops))}`,
    recovery: `
      ${row('Recover a stalled stream after', 'With no progress for this long, reload the stream, then switch to another.', range('stallMinutes', 5, 60, 1, 'min'))}
      ${row('Alert when credit goes elsewhere', 'Kick credits one stream per account. Plays a sound when this one stops being credited because another is playing.', `<button class="btn sm" data-action="test-sound">${icon('bell')} Test</button>${toggle('alertOnStall', s.alertOnStall)}`)}
      ${s.alertOnStall ? row('Repeat the alarm', 'Keeps chiming until you press Stop alarm on the banner, or credit comes back.', `${s.repeatAlert ? seg('setting-value', String(s.alertRepeatSeconds ?? 30), [['15', '15s'], ['30', '30s'], ['60', '1 min']]).replace(/data-action="setting-value"/g, 'data-action="setting-value" data-key="alertRepeatSeconds"') : ''}${toggle('repeatAlert', s.repeatAlert)}`) : ''}`,
    notifications: (() => {
      const where = mac ? 'System Settings › Notifications' : navigator.platform.startsWith('Win') ? 'Settings › System › Notifications' : 'your system’s notification settings';
      const result =
        { failed: `Your computer blocked it. Allow notifications for Pear Drops in ${where}.`, sent: `Sent. If you didn’t see it, allow notifications for Pear Drops in ${where}.` }[ui.notifyTest] ??
        NOTIFY_TEST[ui.notifyTest] ??
        'If your computer blocks them, nothing shows. Send a test to check.';
      const on = s.notify ?? {};
      const system = mac || navigator.platform.startsWith('Win') ? `<button class="btn sm" data-action="notify-system">${icon('settings')} System settings</button>` : '';
      // The kinds as tiles, two to a row, so the whole tab fits without scrolling. A click anywhere on one switches it.
      const kinds = NOTIFY_KINDS.map(
        ([kind, title, sub]) =>
          `<button class="notify-kind ${on[kind] ? 'on' : ''}" data-action="notify-toggle" data-kind="${kind}"><span class="text"><b>${title}</b><span>${sub}</span></span><span class="switch ${on[kind] ? 'on' : ''}"></span></button>`,
      ).join('');
      return `<p class="pane-note">Your computer’s own notifications, also while Pear Drops is in the background or in the ${tray}.</p>
      ${row('Check they work', `<span class="notify-result ${ui.notifyTest ?? ''}">${result}</span>`, `<button class="btn sm" data-action="notify-test" ${ui.notifyTest === 'sending' ? 'disabled' : ''}>${icon('bell')} Send a test</button>${system}`)}
      <div class="notify-grid">${kinds}</div>
      ${row('Only when Pear Drops isn’t in front', 'Skip them while you’re looking at the app.', toggle('notifyAway', s.notifyAway))}`;
    })(),
    refresh: `
      <p class="pane-note">How often the app checks Kick. Shorter is more responsive; longer makes fewer requests.</p>
      ${row('Progress and claims', 'Your drop progress, auto-claims, and whether the current stream is still live.', range('refreshSeconds', 30, 300, 15, 's'))}
      ${row('Live streams per category', 'Which channels are live for each drop. Categories with nothing live are checked every refresh.', range('streamsMinutes', 1, 15, 1, 'min'))}
      ${row('Drop campaigns', 'New and ended campaigns. The ↻ button in the title bar checks right away.', range('campaignsMinutes', 2, 60, 1, 'min'))}
      ${row('Channels you follow', 'Used to prefer streamers you follow.', range('followedMinutes', 5, 60, 5, 'min'))}`,
    app: `
      ${row('Stream panel', 'Light shows Kick’s embed player with the popout chat, like Stream Multiview: much lighter on your computer. Full shows the whole channel page. Both earn drops the same way.', seg('setting-value', s.playerMode === 'full' ? 'full' : 'light', [['light', 'Light'], ['full', 'Full page']]).replace(/data-action="setting-value"/g, 'data-action="setting-value" data-key="playerMode"'))}
      ${s.playerMode === 'full' ? '' : row('Show chat under the stream', 'Hide it to save a little more.', toggle('showChat', s.showChat !== false))}
      ${s.playerMode === 'full' ? row('Stream quality', 'Drops credit the same at any quality; lower uses less CPU and data.', seg('setting-value', String(s.playerQuality ?? 'auto'), [['160', '160p'], ['360', '360p'], ['720', '720p'], ['auto', 'Auto']]).replace(/data-action="setting-value"/g, 'data-action="setting-value" data-key="playerQuality"')) : ''}
      ${row('Font', `System uses your computer’s own font${mac ? ' (SF Pro)' : navigator.platform.startsWith('Win') ? ' (Segoe UI)' : ''}. Inter comes with the app and looks the same on every computer.`, seg('setting-value', s.font === 'bundled' ? 'bundled' : 'system', [['system', 'System'], ['bundled', 'Inter']]).replace(/data-action="setting-value"/g, 'data-action="setting-value" data-key="font"'))}
      ${row(`Keep running in the ${tray}`, `Closing or minimizing the window keeps farming. Quit from the ${tray} icon.`, toggle('minimizeToTray', s.minimizeToTray))}
      ${row('Show progress next to the icon', `The current drop's percentage beside the ${tray} ring.`, toggle('trayPercent', s.trayPercent))}
      ${row('Keep the player unmuted', 'Sound is always muted at the window. Leaving the player itself unmuted keeps it playing normally in the background.', toggle('unmutePlayer', s.unmutePlayer))}`,
    privacy: `
      <div class="security-row ${enc === 'on' ? '' : 'off'}">${icon('lock')}
        ${enc === 'on' ? 'Your Kick login is encrypted with your system keychain.' : 'Login encryption is off. Start the app with npm start to turn it on.'}</div>
      ${row('Forget my login when I quit', 'Signs you out of Kick every time the app closes.', toggle('forgetOnQuit', s.forgetOnQuit))}
      ${backupRows(row, seg)}
      <p class="pane-note">Your settings, history and drop archive stay in the app’s data folder and never leave this computer.</p>`,
    account: `
      <div class="account-card">${img(user?.avatar, 'avatar lg')}<div><b>${esc(user?.username ?? '')}</b><div class="card-sub">Signed in to Kick</div></div>
        <div class="spacer"></div><button class="btn danger" data-action="logout">${icon('logout')} Sign out</button></div>`,
    apps: ui.settingsTab === 'apps' ? connectedPane() : '',
    updates: ui.settingsTab === 'updates' ? updatesPane() : '',
  };

  const activityOpen = ui.settingsTab === 'apps' && !!act.app;
  setHTML(
    root,
    `<div class="modal-backdrop" data-action="close-modal">
      <div class="modal settings-modal" data-stop>
        <nav class="settings-nav">
          <h3>Settings</h3>
          ${SETTINGS_TABS.map(([id, ic, label]) => `<button class="settings-tab ${ui.settingsTab === id ? 'active' : ''}" data-action="settings-tab" data-id="${id}">${icon(ic)}${label}</button>`).join('')}
        </nav>
        <section class="settings-pane">
          <div class="modal-head"><h3>${activityOpen ? `<button class="btn sm icon-only ghost act-back" data-action="act-close" data-tip="Back to Connected apps">${icon('chevronLeft')}</button>Activity` : SETTINGS_TABS.find(([id]) => id === ui.settingsTab)[2]}</h3><button class="btn sm icon-only ghost" data-action="close-modal" data-tip="Close (Esc)">${icon('x')}</button></div>
          <div class="modal-section pane-${ui.settingsTab}${activityOpen ? ' activity' : ''}">${panes[ui.settingsTab]}</div>
        </section>
      </div>
    </div>`,
  );
  if (activityOpen) fitActivity();
}

function openModal(name) {
  ui.modal = name;
  window.pd.suspendPlayer(true);
  render();
}

function closeModal() {
  // The "Updated" card is shown once.
  if (ui.modal === 'whatsnew') window.pd.updates.seen();
  ui.modal = null;
  act.app = null;
  window.pd.suspendPlayer(false);
  render();
}

// ------------------------------------------------------------------ toasts + sound

function toast({ title, body, kind = '', image }) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `${image ? img(image) : `<span class="stat-icon ${kind === 'claim' ? 'gold' : 'green'}" style="width:36px;height:36px">${icon(kind === 'alert' ? 'alert' : 'gift')}</span>`}
    <div><b>${esc(title)}</b><span>${esc(body)}</span></div>`;
  // Bottom right of the dashboard, clear of the docked stream (and of the charts on the left).
  const host = $('#toasts');
  host.style.right = `${Math.max(24, innerWidth - popupWall(innerHeight - 220, innerHeight) + 24)}px`;
  // Above the Queue's Coming soon card when it's showing, in the space over it.
  const plan = document.querySelector('#side .coming')?.getBoundingClientRect();
  host.style.bottom = plan?.height ? `${Math.max(24, innerHeight - plan.top + 12)}px` : '';
  host.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    setTimeout(() => el.remove(), 320);
  }, 6000);
}

// The conflict alarm, repeating while it's switched on and the conflict lasts.
const alarm = { timer: null, sawConflict: false };

function startAlarm() {
  if (!state.settings.alertOnStall) return;
  playAlert();
  if (!state.settings.repeatAlert || alarm.timer) return;
  alarm.timer = setInterval(() => {
    if (!state.settings.repeatAlert || !farm()?.conflict) return stopAlarm();
    playAlert();
  }, (state.settings.alertRepeatSeconds || 30) * 1000);
  render();
}

function stopAlarm() {
  if (!alarm.timer) return;
  clearInterval(alarm.timer);
  alarm.timer = null;
  render();
}

let audioCtx = null;
function playAlert() {
  audioCtx ??= new AudioContext();
  const ctx = audioCtx;
  const t0 = ctx.currentTime + 0.02;
  const master = ctx.createGain();
  master.gain.value = 0.22;
  master.connect(ctx.destination);
  // Three descending two-note chimes.
  [0, 0.55, 1.1].forEach((offset) => {
    [
      [880, 0],
      [659.25, 0.16],
    ].forEach(([freq, d]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = t0 + offset + d;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(1, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.45);
      osc.connect(gain).connect(master);
      osc.start(start);
      osc.stop(start + 0.5);
    });
  });
}

function checkToasts() {
  const f = farm();
  if (!f) return;
  for (const e of f.timeline) {
    if (e.type !== 'claim') continue;
    const key = `${e.t}:${e.name}`;
    if (ui.seenToasts.has(key)) continue;
    ui.seenToasts.add(key);
    if (!ui.firstState) toast({ title: 'Drop claimed', body: e.name, kind: 'claim' });
  }
  ui.firstState = false;
}

// ------------------------------------------------------------------ render loop

function render({ tick = false } = {}) {
  if (!state) return;
  applyFont(state.settings?.font);
  const signedIn = state.auth.status === 'signed-in';
  $('#welcome').hidden = signedIn;
  $('#app').hidden = !signedIn;
  if (!signedIn) {
    window.pd.setPlayerBounds(null);
    lastBounds = '';
    renderWelcome();
    return;
  }
  ui.playerOpen = state.settings.playerOpen !== false;
  renderTitlebar();
  const history = ui.view === 'history';
  $('#content').hidden = history;
  $('#history').hidden = !history;
  if (history) {
    if (!tick) renderHistory();
    renderPlayer();
    renderModal();
    checkToasts();
    return;
  }
  renderBanner();
  renderHero();
  renderStats();
  renderChart();
  renderSide();
  renderPlayer();
  renderModal();
  checkToasts();
}

// ------------------------------------------------------------------ events

/** The order of the categories that can still be sorted (finished ones stay at the bottom). */
function categoryOrder() {
  return (farm()?.categories ?? []).filter((c) => !c.complete).map((c) => c.id);
}

const actions = {
  ...historyActions,
  ...activityActions,
  ...updateActions,
  view: (el) => {
    ui.view = el.dataset.id;
    if (ui.view === 'history') loadHistory();
    render();
  },
  login: () => window.pd.login(),
  logout: () => {
    closeModal();
    window.pd.logout();
  },
  pause: () => window.pd.pause(true),
  resume: () => window.pd.pause(false),
  refresh: () => window.pd.refresh(),
  skip: () => window.pd.skip(),
  reload: () => window.pd.reload(),
  settings: () => openModal('settings'),
  'close-modal': () => closeModal(),
  'test-sound': () => playAlert(),
  'stop-alarm': () => stopAlarm(),
  follow: async (el) => {
    const slug = el.dataset.slug;
    const on = !!el.dataset.on;
    ui.followBusy = slug;
    render();
    const r = await window.pd.follow(slug, on);
    ui.followBusy = null;
    if (r?.error) toast({ title: on ? 'Couldn’t follow' : 'Couldn’t unfollow', body: r.error === 'login' ? 'Kick asked you to sign in again.' : 'Kick didn’t accept it. Try again in a moment.', kind: 'alert' });
    render();
  },
  'toggle-player': () => window.pd.setSettings({ playerOpen: !ui.playerOpen }),
  'open-kick': (el) => window.pd.openExternal(`https://kick.com/${el.dataset.slug}`),
  'chart-campaign': (el) => {
    ui.chartCampaign = el.dataset.id;
    render();
  },
  'queue-mode': (el) => {
    $('#nudge')?.classList.remove('on');
    window.pd.setSettings({ queueMode: el.dataset.id });
  },
  'settings-tab': (el) => {
    ui.settingsTab = el.dataset.id;
    act.app = null; // Connected apps opens on its cards
    render();
  },
  'side-tab': (el) => {
    ui.sideTab = el.dataset.id;
    render();
  },
  'past-filter': (el) => {
    ui.pastFilter = el.dataset.id;
    render();
  },
  'select-cat': (el) => {
    ui.selectedCategory = Number(el.dataset.id);
    render();
  },
  expand: (el) => {
    const id = Number(el.dataset.id);
    ui.expanded.has(id) ? ui.expanded.delete(id) : ui.expanded.add(id);
    render();
  },
  'cat-up': (el) => moveCategory(Number(el.dataset.id), -1),
  'cat-down': (el) => moveCategory(Number(el.dataset.id), 1),
  'cat-toggle': (el) => {
    const id = Number(el.dataset.id);
    const disabled = new Set(state.settings.disabledCategories);
    disabled.has(id) ? disabled.delete(id) : disabled.add(id);
    window.pd.setSettings({ disabledCategories: [...disabled] });
  },
  watch: async (el) => {
    try {
      await window.pd.watch(el.dataset.slug, Number(el.dataset.cat));
    } catch (err) {
      toast({ title: 'Could not switch', body: String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), kind: 'alert' });
    }
  },
  claim: async (el) => {
    const r = await window.pd.claim(el.dataset.campaign, el.dataset.reward).catch(() => ({ error: 'Kick didn’t answer. Try again in a minute.' }));
    if (r?.error) toast({ title: 'Couldn’t claim it', body: r.connectUrl ? `${r.error}. Use Link your account on the reward.` : r.error, kind: 'alert' });
  },
  'open-link': (el) => window.pd.openExternal(el.dataset.url),
  'setting-value': (el) => window.pd.setSettings({ [el.dataset.key]: el.dataset.id }),
  'coming-pick': (el) => {
    ui.comingIdx = Number(el.dataset.id);
    ui.comingAt = Date.now();
    render();
  },
  'notify-toggle': (el) => {
    const notify = { ...(state.settings.notify ?? {}) };
    notify[el.dataset.kind] = !notify[el.dataset.kind];
    window.pd.setSettings({ notify });
  },
  'notify-test': async () => {
    ui.notifyTest = 'sending';
    render();
    ui.notifyTest = await window.pd.notifyTest().catch(() => 'failed');
    render();
  },
  'notify-system': () => window.pd.notifySystemSettings(),
  'backup-now': () => window.pd.backups.run(),
  'backup-show': () => window.pd.backups.show(),
  'connected-toggle': (el) => {
    const p = state.connected?.peers?.find((x) => x.id === el.dataset.id);
    window.pd.connected.set(el.dataset.id, !p?.enabled);
  },
  'connected-disconnect': (el) => window.pd.connected.disconnect(el.dataset.id),
  'connected-pair-again': (el) => window.pd.connected.pairAgain(el.dataset.id),
  'connected-test': async (el) => {
    const id = el.dataset.id;
    ui.appTests = { ...ui.appTests, [id]: { running: true, at: Date.now() } };
    render();
    const result = await window.pd.connected.test(id).catch(() => ({ ok: false, text: 'The test couldn’t run' }));
    ui.appTests = { ...ui.appTests, [id]: { result, at: Date.now() } };
    render();
    // Back to the usual line once its moment is up.
    setTimeout(render, 15_100);
  },
  'open-connected-apps': () => {
    ui.settingsTab = 'apps';
    openModal('settings');
  },
  'setting-toggle': (el) => {
    const key = el.dataset.key;
    const current = key === 'showChat' ? state.settings.showChat !== false : state.settings[key];
    window.pd.setSettings({ [key]: !current });
  },
};

// ---- drag to reorder the queue
// Pointer events rather than the browser's drag and drop: they behave the same on every
// system (on Linux a drag session swallows pointer input and can end without a dragend).
// The dragged row follows the pointer as a lifted card, drawn by the page itself, so it
// shows in screenshots and recordings.
const DRAG_START_PX = 4;
let press = null;
let ghost = null;

function dropTarget(x, y) {
  // The lifted card ignores the pointer, so this finds the row underneath it.
  const row = document.elementFromPoint(x, y)?.closest?.('.cat[data-reorder]');
  if (!row || !ui.drag) return null;
  const r = row.getBoundingClientRect();
  return { row, id: Number(row.dataset.catId), after: y > r.top + r.height / 2 };
}

function moveGhost(y) {
  if (ghost) ghost.el.style.transform = `translate3d(0, ${Math.round(y - ghost.dy - ghost.top)}px, 0) rotate(-0.6deg) scale(1.02)`;
}

function clearDropMarks() {
  document.querySelectorAll('.cat.drop-before, .cat.drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
}

function startDrag(row, y, pointerId) {
  ui.drag = { id: Number(row.dataset.catId) };
  const r = row.getBoundingClientRect();
  const el = row.cloneNode(true);
  el.classList.add('drag-ghost');
  Object.assign(el.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px` });
  el.querySelector('.cat-campaigns')?.remove();
  document.body.appendChild(el);
  ghost = { el, top: r.top, dy: y - r.top };
  row.classList.add('dragging');
  // Keeps the drag's pointer events coming to this row, even outside the window. The click
  // that ends the drag then lands on the row itself, not on the part that opens it.
  try {
    row.setPointerCapture(pointerId);
  } catch {}
}

function endDrag() {
  ghost?.el.remove();
  ghost = null;
  clearDropMarks();
  document.querySelectorAll('.cat.dragging').forEach((el) => el.classList.remove('dragging'));
  ui.drag = null;
  render();
}

function dropOn(t) {
  if (!t || t.id === ui.drag.id) return;
  const order = categoryOrder().filter((id) => id !== ui.drag.id);
  let at = order.indexOf(t.id);
  if (at < 0) return;
  if (t.after) at += 1;
  order.splice(at, 0, ui.drag.id);
  window.pd.setSettings({ categoryOrder: order });
}

document.addEventListener('pointerdown', (event) => {
  const row = event.button === 0 && event.target.closest?.('.cat[data-reorder]');
  press = row && !event.target.closest('button, a, input, .cat-campaigns') ? { row, x: event.clientX, y: event.clientY, id: event.pointerId } : null;
});
document.addEventListener('pointermove', (event) => {
  if (!press) return;
  if (!ui.drag) {
    if (!(event.buttons & 1)) return (press = null);
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_START_PX) return;
    startDrag(press.row, press.y, press.id);
  }
  moveGhost(event.clientY);
  clearDropMarks();
  const t = dropTarget(event.clientX, event.clientY);
  if (t && t.id !== ui.drag.id) t.row.classList.add(t.after ? 'drop-after' : 'drop-before');
});
document.addEventListener('pointerup', (event) => {
  press = null;
  if (!ui.drag) return;
  dropOn(dropTarget(event.clientX, event.clientY));
  endDrag();
});
document.addEventListener('pointercancel', () => {
  press = null;
  if (ui.drag) endDrag();
});
// A row's pictures would otherwise start the browser's own image drag, which cancels this one.
document.addEventListener('dragstart', (event) => {
  if (event.target.closest?.('.cat[data-reorder]')) event.preventDefault();
});

// ---- a friendly nudge when someone tries to drag the queue in Smart mode
let smartPress = null;
let nudgeTimer = null;

function showSmartNudge(row, x, y) {
  row.classList.remove('wiggle');
  void row.offsetWidth;
  row.classList.add('wiggle');
  document.querySelector('.queue-mode')?.classList.add('pulse');
  let el = $('#nudge');
  if (!el) {
    el = Object.assign(document.createElement('div'), { id: 'nudge', className: 'nudge' });
    document.body.appendChild(el);
  }
  el.innerHTML = `<span class="spark s1">✦</span><span class="spark s2">✦</span><span class="spark s3">✦</span>
    <div class="nudge-icon">${icon('bolt')}</div>
    <div class="nudge-text"><b>Smart order is on</b><span>The queue sorts itself by what expires first.</span></div>
    <button class="btn sm primary" data-action="queue-mode" data-id="manual">Switch to Manual</button>`;
  const w = 330;
  el.style.left = `${Math.max(12, Math.min(innerWidth - w - 12, x - w / 2))}px`;
  el.style.top = `${Math.max(12, y - 92)}px`;
  el.classList.remove('on');
  void el.offsetWidth;
  el.classList.add('on');
  clearTimeout(nudgeTimer);
  nudgeTimer = setTimeout(() => {
    el.classList.remove('on');
    document.querySelector('.queue-mode')?.classList.remove('pulse');
  }, 4200);
}

document.addEventListener('pointerdown', (event) => {
  const row = event.target.closest?.('.cat.smart');
  smartPress = row && !event.target.closest('button') ? { row, x: event.clientX, y: event.clientY } : null;
});
document.addEventListener('pointermove', (event) => {
  if (!smartPress || !(event.buttons & 1)) return;
  if (Math.hypot(event.clientX - smartPress.x, event.clientY - smartPress.y) < 8) return;
  showSmartNudge(smartPress.row, event.clientX, event.clientY);
  smartPress = null;
});
document.addEventListener('pointerup', () => (smartPress = null));

function moveCategory(id, dir) {
  const order = categoryOrder();
  const i = order.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  window.pd.setSettings({ categoryOrder: order });
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  // Clicks inside a modal shouldn't fall through to its backdrop (which closes it).
  if (target.classList.contains('modal-backdrop') && event.target.closest('[data-stop]')) return;
  event.stopPropagation();
  actions[target.dataset.action]?.(target);
});

document.addEventListener('input', (event) => {
  const key = event.target.dataset?.setting;
  if (!key) return;
  const out = event.target.nextElementSibling;
  if (out) out.textContent = `${event.target.value} ${event.target.dataset.unit ?? ''}`;
});
document.addEventListener('change', (event) => {
  const key = event.target.dataset?.setting;
  if (key) window.pd.setSettings({ [key]: Number(event.target.value) });
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && ui.modal === 'settings' && ui.settingsTab === 'apps' && act.app) closeActivity();
  else if (event.key === 'Escape' && ui.modal) closeModal();
});

new ResizeObserver(() => syncPlayerBounds()).observe($('#player-slot'));
window.addEventListener('resize', () => syncPlayerBounds());
$('.layout').addEventListener('transitionend', () => syncPlayerBounds());

// ------------------------------------------------------------------ boot

setHTML($('#brand-mark'), brandMark(32));
initUpdates();
window.pd.onState((next) => {
  state = next;
  render();
});
// Coming soon doesn't move on while the pointer is on it.
document.addEventListener('pointerover', (e) => (ui.comingHover = !!e.target.closest?.('.coming')));
document.documentElement.addEventListener('pointerleave', () => (ui.comingHover = false));

// A desktop notification was clicked: the app came forward, on the view it's about.
window.pd.onShowView((view) => {
  if (!['dashboard', 'history'].includes(view) || ui.view === view) return;
  ui.view = view;
  if (view === 'history') loadHistory();
  render();
});
window.pd.onAlert((alert) => {
  if (alert.kind !== 'stall') return;
  startAlarm();
  toast({ title: 'Another Kick stream is taking your credit', body: `${alert.events} watch events got no credit. Close any other streams to continue progressing drops.`, kind: 'alert' });
});
// Capture mode only: the player's and the chat's frames, drawn where the docked views would be.
const mirrorUrls = {};
window.pd.onPlayerFrame((role, jpeg) => {
  const el = $(role === 'chat' ? '#chat-mirror' : '#player-mirror');
  if (mirrorUrls[role]) URL.revokeObjectURL(mirrorUrls[role]);
  mirrorUrls[role] = URL.createObjectURL(new Blob([jpeg], { type: 'image/jpeg' }));
  el.src = mirrorUrls[role];
  el.hidden = !farm()?.current || (role === 'chat' && !mirrorShowsChat());
});
window.pd.getState().then((initial) => {
  state ??= initial;
  render();
});
// Countdowns, "ago" labels and the live chart move every second.
setInterval(() => render({ tick: true }), 1000);
// History follows new events, and its time ranges move with the clock.
let historyTimer = null;
const refreshHistorySoon = () => {
  if (ui.view !== 'history' || historyTimer) return;
  historyTimer = setTimeout(() => {
    historyTimer = null;
    loadHistory();
  }, 2000);
};
window.pd.onHistoryChanged(refreshHistorySoon);
setInterval(refreshHistorySoon, 30_000);
