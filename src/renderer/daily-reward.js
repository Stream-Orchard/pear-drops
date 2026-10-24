/* global icon, esc, img, fmtDur, fmtClock, MIN */
// Kick's Daily Reward, drawn the same way on the dashboard (the title-bar chest and its card) and in
// the tray: watch an hour, open a crate, a reel picks a card.
// The state comes from the main process (src/main/daily-reward.js); nothing here calls Kick.

const RARITIES = [
  ['common', 'Common'],
  ['uncommon', 'Uncommon'],
  ['rare', 'Rare'],
  ['epic', 'Epic'],
  ['legendary', 'Legendary'],
  ['mythic', 'Mythic'],
];
const rarityName = (r) => RARITIES.find(([id]) => id === r)?.[1] ?? 'Common';
/** A count as people read it: 1,234. */
const n = (v) => Number(v ?? 0).toLocaleString();

/** A chance as people say it: 55%, 4.7%, 0.3%, and "1 in 200,000" once it's tiny. */
function fmtChance(fraction) {
  const p = (fraction ?? 0) * 100;
  if (p <= 0) return '0%';
  if (p < 0.01) return `1 in ${Math.round(1 / fraction).toLocaleString()}`;
  if (p < 1) return `${Number(p.toPrecision(2))}%`;
  return `${Number(p.toFixed(p < 10 ? 1 : 0))}%`;
}

// The chest: Kick's chest (a strap on the left, a notched latch) drawn as a line icon like the
// rest of the set. When the reward is ready it hops the way kick.com's does, and lands in a burst
// of pixels (daily-reward.css); no video, so it works offline, in demo mode and stops for reduced motion.
const BURST = [
  [2.2, 20.1, 'g'], [4.4, 21.8, 't'], [7.6, 22.7, 'g'], [11, 23.1, 't'], [14.4, 22.9, 'g'], [17.8, 22.4, 't'],
  [20.6, 21.1, 'g'], [21.4, 19.1, 't'], [1.6, 18.3, 't'], [19.2, 17.9, 'g'],
];
function chestMark(cls = '') {
  return `<svg class="icon chest ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <g class="chest-burst" stroke="none">${BURST.map(([x, y, c]) => `<rect class="${c}" x="${x - 0.7}" y="${y - 0.7}" width="1.4" height="1.4"/>`).join('')}</g>
    <g class="chest-box"><path class="chest-body" d="M3.5 8.5 5.5 4.5h13l2 4v10a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z"/><path d="M3.5 9.5h17M8.5 4.5v15"/>
      <path class="chest-latch" d="M12.6 9.5v2.8l2.65 2.1 2.65-2.1V9.5"/></g>
  </svg>`;
}

// The pixels the opening crate throws out: [x, y, size, colour, how far it flies x, y].
const CRATE_SPARKS = [
  [96, 64, 5, 'g', -46, -88], [110, 62, 4, 't', -18, -112], [124, 62, 6, 'g', 6, -124], [138, 63, 4, 't', 30, -100],
  [150, 64, 5, 'g', 58, -82], [84, 66, 4, 't', -70, -58], [158, 66, 4, 't', 76, -56], [118, 64, 3, 'g', -6, -70],
];
let crateId = 0;

/**
 * Our own crate, for demo mode and whenever Kick's video doesn't play. 'opening' adds what the
 * reveal animates (daily-reward.css): the lid's underside (it swings back on a hinge at the back of
 * the box, and stays on), the light inside, and the pixels it throws out. Each copy has
 * ids of its own: a gradient whose id repeats paints from the first copy, which may be hidden.
 */
function crateArt(cls = '') {
  const id = `dr${(crateId += 1)}`;
  const opening = cls.includes('opening');
  return `<svg class="dr-crate-art ${cls}" viewBox="0 0 240 170" aria-hidden="true">
    <defs>
      <linearGradient id="${id}-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2f37"/><stop offset="1" stop-color="#101318"/></linearGradient>
      <linearGradient id="${id}-lid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#343a44"/><stop offset="1" stop-color="#1b1f26"/></linearGradient>
      <radialGradient id="${id}-shine" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#53fc18" stop-opacity=".6"/><stop offset=".55" stop-color="#2ee6c5" stop-opacity=".18"/><stop offset="1" stop-color="#53fc18" stop-opacity="0"/></radialGradient>
      ${opening ? `<linearGradient id="${id}-lining" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#4f8f32"/><stop offset=".3" stop-color="#22341c"/><stop offset="1" stop-color="#14171c"/></linearGradient>
      <linearGradient id="${id}-mouth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9ffc9"/><stop offset="1" stop-color="#53fc18" stop-opacity=".6"/></linearGradient>` : ''}
      ${opening ? `<linearGradient id="${id}-beam" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#b8ff9a" stop-opacity=".95"/><stop offset=".35" stop-color="#53fc18" stop-opacity=".45"/><stop offset="1" stop-color="#2ee6c5" stop-opacity="0"/></linearGradient>` : ''}
    </defs>
    <ellipse class="crate-shadow" cx="120" cy="158" rx="84" ry="8" fill="#000" opacity=".55"/>
    <ellipse class="crate-burst" cx="120" cy="66" rx="110" ry="58" fill="url(#${id}-shine)"/>
    <g class="crate-all">
      ${
        opening
          ? `<path class="crate-beam" d="M50 64 6 -80h228l-44 144z" fill="url(#${id}-beam)"/>
      <g class="crate-lid-open">
        <path d="M37 66 53 4h134l16 62z" fill="url(#${id}-lining)" stroke="#53fc18" stroke-opacity=".28"/>
        <path d="M59 13h122l12 47H47z" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="5" stroke-linejoin="round"/>
        <path d="M45 62h150" stroke="#b8ff9a" stroke-opacity=".55" stroke-width="2" stroke-linecap="round"/>
      </g>`
          : ''
      }
      <g class="crate-body">
        <rect x="40" y="66" width="160" height="86" rx="14" fill="url(#${id}-body)" stroke="rgba(255,255,255,.12)"/>
        <rect class="crate-mouth" x="40" y="66" width="160" height="10" fill="#0b0d10" opacity=".6"/>
        ${opening ? `<rect class="crate-glow-in" x="44" y="62" width="152" height="9" rx="4" fill="url(#${id}-mouth)"/>` : ''}
        <path d="M76 92v44M100 92v44M140 92v44M164 92v44" stroke="rgba(255,255,255,.07)" stroke-width="10" stroke-linecap="round"/>
        <rect x="106" y="82" width="28" height="34" rx="7" fill="#0d1014" stroke="#53fc18" stroke-opacity=".7" stroke-width="2"/>
        <circle class="crate-latch" cx="120" cy="99" r="5" fill="#53fc18"/>
      </g>
      ${opening ? `<g class="crate-sparks">${CRATE_SPARKS.map(([x, y, s, c, dx, dy]) => `<rect class="${c}" x="${x - s / 2}" y="${y - s / 2}" width="${s}" height="${s}" style="--dx:${dx}px;--dy:${dy}px"/>`).join('')}</g>` : ''}
      <g class="crate-lid">
        <path d="M36 66V52a18 18 0 0 1 18-18h132a18 18 0 0 1 18 18v14z" fill="url(#${id}-lid)" stroke="rgba(255,255,255,.14)"/>
        <rect x="62" y="44" width="116" height="8" rx="4" fill="#0b0d10"/>
        <g fill="#53fc18"><rect x="70" y="46" width="22" height="4" rx="2"/><circle cx="104" cy="48" r="2"/><circle cx="114" cy="48" r="2"/><circle cx="124" cy="48" r="2"/><circle cx="134" cy="48" r="2"/><circle cx="144" cy="48" r="2" opacity=".4"/><circle cx="154" cy="48" r="2" opacity=".4"/><circle cx="164" cy="48" r="2" opacity=".4"/></g>
      </g>
    </g>
  </svg>`;
}

/** The crate on the card: Kick's looping video, or our own crate. */
function crateStage(dr) {
  const url = dr.media?.idle;
  return url ? `<video class="dr-crate" src="${esc(url)}" autoplay loop muted playsinline data-fallback="crate"></video>` : crateArt('idle');
}

const rarityChip = (r, extra = '') => `<span class="chip rarity r-${esc(r)}${extra}"><i></i>${rarityName(r)}</span>`;

/**
 * What a card is, in words: "Rare emote". Kick gives no names; the name is on the card's picture.
 * An event's prize comes without a type: "Rare reward".
 */
const cardKind = (c) => `${rarityName(c?.rarity)} ${['badge', 'emote'].includes(c?.type) ? c.type : 'reward'}`;

/** The event crate waiting to be claimed, when the daily one isn't (the chests show it instead). */
const readyCrate = (dr) => (dr?.state !== 'ready' && dr?.crateReady ? ((dr.extras ?? []).find((e) => e.state === 'ready') ?? null) : null);

/** What a claimed card was: new, or a duplicate turned into level progress. */
function winnerLine(t, { short = false } = {}) {
  if (!t?.winner) return '';
  const kind = `<b>${cardKind(t.winner)}</b>`;
  if (!t.duplicate) return `${kind}<span class="chip green new">New</span>`;
  if (short) return `${kind}<span class="chip">Duplicate</span>`;
  const xp = t.xpMinutes ? `<span class="dr-xp">+${fmtDur(t.xpMinutes * MIN)}</span> watch time${t.levelTo ? ` to Level ${n(t.levelTo)}` : ''}` : 'Turned into level progress';
  return `<span class="dr-dupe">You already have this ${kind}</span><span class="dr-sub">${xp}</span>`;
}

// ------------------------------------------------------------------ the chest button

/** What the chest's tooltip says. */
function chestTip(dr) {
  const crate = readyCrate(dr);
  if (crate) return `${crate.name || 'Event reward'} is ready.${crate.endsAt ? ` Claim before ${fmtClock(crate.endsAt)}` : ''}`;
  if (dr.state === 'ready') return `Daily reward is ready. Claim before ${fmtClock(dr.endsAt)}${dr.claimMode === 'before-reset' ? '\nPear Drops claims it 15 minutes before, if you haven’t' : ''}`;
  if (dr.state === 'earning') return `Daily reward · ${dr.minutes} of ${dr.threshold} min\n${dr.threshold - dr.minutes} min to go${dr.watching ? '' : ' (not watching)'}`;
  if (dr.state === 'claimed' && dr.today?.winner) return `Today: a ${cardKind(dr.today.winner).toLowerCase()}${dr.today.duplicate ? ' (a duplicate)' : ''}\nNext one in ${fmtDur(dr.endsAt - Date.now())}`;
  if (dr.state === 'unavailable') return 'Kick’s daily reward isn’t answering right now';
  return 'Daily reward';
}

/**
 * The chest: a ring that fills over the hour, a glowing "Claim reward" chip when it's ready,
 * and, once claimed, just the chest in the winning card's colour.
 * @param {object} dr the daily reward state
 * @param {{ where?: 'titlebar'|'tray', tight?: boolean, open?: boolean }} o
 */
function rewardChest(dr, { where = 'titlebar', tight = false, open = false } = {}) {
  if (!dr || dr.state === 'signed-out' || dr.state === 'hidden') return '';
  // An event's crate waiting: the chest hops in the event's colours and says its name.
  const crate = readyCrate(dr);
  const state = crate ? 'ready' : dr.state;
  const ready = state === 'ready';
  const frac = state === 'earning' ? Math.min(1, dr.minutes / Math.max(1, dr.threshold)) : 0;
  const tone = crate ? `crate theme-${esc(crate.theme ?? 'event')}` : state === 'claimed' ? `r-${esc(dr.today?.winner?.rarity ?? 'common')}` : '';
  const c = 2 * Math.PI * 9;
  const ring = `<svg class="dr-ring" viewBox="0 0 22 22"><circle cx="11" cy="11" r="9" stroke="rgba(255,255,255,.08)" stroke-width="2" fill="none"/>
    <circle class="dr-ring-value" cx="11" cy="11" r="9" stroke-width="2" fill="none" stroke-linecap="round" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - frac)).toFixed(2)}" transform="rotate(-90 11 11)"/></svg>`;
  const cls = `dr-chest at-${where} state-${esc(state)} ${tone} ${open ? 'open' : ''} ${ready && !tight && where === 'titlebar' ? 'chip' : ''}`;
  const label = ready && !tight && where === 'titlebar' ? `<span>${crate ? esc(crate.name || 'Event reward') : 'Claim reward'}</span>` : '';
  return `<button class="${cls}" data-action="reward-open" data-tip="${esc(chestTip(dr))}" aria-label="Daily reward">${state === 'earning' ? ring : ''}${chestMark()}${label}</button>`;
}

// ------------------------------------------------------------------ the card

/** Rarity by rarity: the chance of each, and how much of it is yours. */
function rarityTable(dr) {
  const by = dr.collection?.byRarity ?? {};
  const odds = Object.fromEntries((dr.odds ?? []).map((o) => [o.rarity, o.chance]));
  return `<div class="dr-rarities">
    <div class="dr-rarity head"><span>Rarity</span><span>Chance</span><span class="own">Yours</span></div>
    ${RARITIES.map(([id, name]) => {
      const c = by[id] ?? { owned: 0, total: 0 };
      return `<div class="dr-rarity r-${id}"><span class="name"><i></i>${name}</span><span class="pct">${odds[id] == null ? '—' : fmtChance(odds[id])}</span>
        <span class="own"><span class="bar"><i style="width:${c.total ? (c.owned / c.total) * 100 : 0}%"></i></span><span class="count"><b>${n(c.owned)}</b>/${n(c.total)}</span></span></div>`;
    }).join('')}
  </div>`;
}

/** A small ring with the chance of a duplicate. */
function dupeRing(fraction, size = 30) {
  const r = (size - 4) / 2;
  const c = 2 * Math.PI * r;
  return `<svg class="dr-dupe-ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="rgba(255,255,255,.08)" stroke-width="3.5" fill="none"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="var(--amber)" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - (fraction ?? 0))).toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>`;
}

/** Streak and level, as two quiet facts. */
function factsRow(dr) {
  const lv = dr.level;
  return `<div class="dr-facts">
    <span class="dr-fact streak" data-tip="Your daily reward streak on Kick">${icon('bolt')}<b>${n(dr.streak)}-day</b> streak</span>
    ${
      lv
        ? `<span class="dr-fact level" data-tip="Your Kick level. Duplicates turn into progress towards the next one">${lv.badge ? img(lv.badge, 'dr-level-badge') : icon('trophy')}<b>Level ${n(lv.level)}</b>
          <span class="bar"><i style="width:${lv.toNext ? Math.min(100, (lv.progress / (lv.progress + lv.toNext)) * 100) : 0}%"></i></span></span>`
        : ''
    }
  </div>`;
}

// ------------------------------------------------------------------ the crates, as tabs

/**
 * Every crate Kick offers today: the daily one first, then the others in Kick's order (an
 * event's, the Welcome Reward). One tab each; a single crate has no tabs.
 */
function crateList(dr) {
  const daily = { id: dr.id ?? 'daily', daily: true, label: 'Daily', title: 'Daily reward', state: dr.state, theme: 'daily' };
  return [daily, ...(dr.extras ?? []).map((e) => ({ id: e.id, label: e.name || 'Event reward', title: e.name || 'Event reward', state: e.state, theme: e.theme ?? 'event', prize: e.won?.winner }))];
}

/** The tab the card opens on: the daily crate when it's ready, else a ready one, else the daily. */
function openTab(dr) {
  if (!dr || dr.state === 'ready') return dr?.id ?? null;
  return (dr.extras ?? []).find((e) => e.state === 'ready')?.id ?? dr.id ?? null;
}

function crateTabs(crates, active) {
  return crates
    .map((c) => {
      const mark = c.state === 'claimed' && c.prize?.image ? `<span class="dr-tab-prize r-${esc(c.prize.rarity)}">${img(c.prize.image)}</span>` : chestMark();
      const tip = c.state === 'ready' ? `${c.title}: ready to claim` : c.title;
      return `<button class="dr-tab theme-${esc(c.theme)} state-${esc(c.state)} ${c.id === active ? 'on' : ''}" data-action="reward-tab" data-id="${esc(c.id)}" data-tip="${esc(tip)}" aria-pressed="${c.id === active}">${mark}<span>${esc(c.label)}</span></button>`;
    })
    .join('');
}

/** A day's watch time as people say it: "3h", "1h 30m", "60 min". */
const fmtHours = (minutes) => (minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60}h` : fmtLeft(minutes));

/** "36 min", or "1h 08m" for an event's longer wait. */
const fmtLeft = (minutes) => (minutes < 60 ? `${minutes} min` : fmtDur(minutes * MIN));

/**
 * The claim button, the same for every crate in its colours (the daily's are Kick's green). Ready:
 * one solid colour under the label, the second running round its edge, the chest hopping. Filling:
 * a dark face that never changes under the label; the progress runs along its bottom edge and
 * round the chest, and glows when nearly there.
 * @param {{ id?: string, state: string, theme: string, minutes: number, threshold: number, watching: boolean, claiming: boolean, daily?: boolean }} c
 */
function claimButton(c) {
  const id = c.daily ? '' : ` data-id="${esc(c.id)}"`;
  if (c.state === 'ready') {
    return `<button class="btn lg dr-claim ready theme-${esc(c.theme)} ${c.claiming ? 'busy' : ''}" data-action="reward-claim"${id} ${c.claiming ? 'disabled' : ''}>${chestMark()}<span>${c.claiming ? 'Claiming…' : 'Claim'}</span></button>`;
  }
  const left = Math.max(0, c.threshold - c.minutes);
  const frac = Math.min(1, c.minutes / Math.max(1, c.threshold));
  const r = 2 * Math.PI * 11;
  const ring = `<span class="dr-claim-ring"><svg viewBox="0 0 26 26"><circle class="track" cx="13" cy="13" r="11"/><circle class="val" cx="13" cy="13" r="11" stroke-dasharray="${r.toFixed(2)}" stroke-dashoffset="${(r * (1 - frac)).toFixed(2)}"/></svg>${chestMark()}</span>`;
  const label = c.watching ? `Claim in <b>${fmtLeft(left)}</b>` : `Watch <b>${left < 60 ? left : fmtDur(left * MIN)}</b> more${left < 60 ? ' min' : ''}`;
  const near = c.watching && frac >= 0.9 ? 'near' : '';
  return `<button class="btn lg dr-claim fill theme-${esc(c.theme)} ${c.watching ? '' : 'paused'} ${near}" data-action="reward-claim"${id} disabled>${ring}<span>${label}</span><span class="dr-claim-line"><i style="width:${(frac * 100).toFixed(1)}%"></i></span></button>`;
}

/**
 * The card's top: its tabs (more than one crate) or its name, and what to know about the open
 * crate's time ("Claim before 12:00 AM").
 */
function cardHead(crates, active, { where, title, sub, theme }) {
  const close = where === 'tray' ? `<button class="btn sm icon-only ghost" data-action="reward-back" data-tip="Back">${icon('chevronLeft')}</button>` : '';
  const x = where === 'pop' ? `<button class="btn sm icon-only ghost" data-action="reward-close" data-tip="Close (Esc)">${icon('x')}</button>` : '';
  if (crates.length < 2) return `<div class="dr-head">${close}${chestMark()}<b>${esc(title)}</b>${sub ? `<span class="dr-head-sub">${sub}</span>` : ''}<span class="spacer"></span>${x}</div>`;
  return `<div class="dr-head tabs">${close}<div class="dr-tabs" role="tablist">${crateTabs(crates, active)}</div><span class="spacer"></span>${x}</div>
    <div class="dr-subline theme-${esc(theme)}"><b>${esc(title)}</b>${sub ? `<span class="dr-head-sub">${sub}</span>` : ''}</div>`;
}

/** What to know about a crate's time: when it resets, the deadline, or the next one. */
const crateSub = (state, endsAt) => (!endsAt ? '' : { earning: `Resets at ${fmtClock(endsAt)}`, ready: `Claim before ${fmtClock(endsAt)}`, claimed: `Next one in ${fmtDur(endsAt - Date.now())}` }[state] ?? '');

/**
 * The daily reward card: a tab per crate Kick offers (the daily one, an event's, the Welcome
 * Reward), and the open one's page, with the claim and the reveal.
 * @param {object} dr the daily reward state
 * @param {{ where?: 'pop'|'tray', revealing?: boolean, tab?: string|null }} o tab: the open crate's id (the daily's when unset or gone)
 */
function rewardCard(dr, { where = 'pop', revealing = false, tab = null } = {}) {
  if (!dr) return '';
  const crates = dr.state === 'unavailable' || dr.state === 'loading' ? [] : crateList(dr);
  const e = (dr.extras ?? []).find((x) => x.id === tab);
  if (e) return crateCard(dr, e, crates, { where, revealing });
  const left = Math.max(0, dr.threshold - dr.minutes);
  const top = cardHead(crates, dr.id, { where, title: 'Daily reward', sub: crateSub(dr.state, dr.endsAt), theme: 'daily' });

  if (dr.state === 'unavailable' || dr.state === 'loading') {
    return `<div class="dr-card at-${where} state-${dr.state}">${top}
      <div class="dr-stage">${crateArt('idle dim')}<div class="dr-stage-msg">${dr.state === 'loading' ? '<span class="spinner"></span>Asking Kick…' : `${icon('alert')}Kick’s daily reward isn’t answering. Pear Drops tries again in a few minutes.`}</div></div>
      <div class="dr-actions"><button class="btn" data-action="reward-kick">${icon('external')} Open on Kick</button></div></div>`;
  }

  let stage;
  let middle;
  let actions;
  if (dr.state === 'claimed') {
    const t = dr.today ?? {};
    // Claimed on kick.com (or before Pear Drops was running): Kick may not say what it was.
    stage = t.winner
      ? `<div class="dr-stage won r-${esc(t.winner.rarity)}"><div class="dr-won-glow"></div>${img(t.winner.image, 'dr-won-card', cardKind(t.winner))}</div>
      <div class="dr-result">${winnerLine(t)}</div>`
      : `<div class="dr-stage">${crateArt('dim')}<div class="dr-stage-msg">${icon('check')}Claimed today, outside Pear Drops.</div></div>`;
    middle = `${factsRow(dr)}${rarityTable(dr)}
      <div class="dr-dupe-line">${dupeRing(dr.duplicateChance)}<span><b>${fmtChance(dr.duplicateChance)} chance of a duplicate tomorrow</b><small>${n(dr.collection?.owned)} of Kick’s ${n(dr.collection?.total)} cards are yours</small></span></div>`;
    actions = `<div class="dr-actions">${t.replay ? `<button class="btn" data-action="reward-replay">${icon('play')} Replay</button>` : ''}<button class="btn" data-action="reward-collection" data-tip="Every card, and which are yours, on kick.com">${icon('external')} Collection</button></div>`;
  } else {
    const ready = dr.state === 'ready';
    // While it's ready, the opening video loads in the background, so the reveal starts at once.
    const preload = ready && dr.media?.unbox ? `<video class="dr-preload" src="${esc(dr.media.unbox)}" preload="auto" muted hidden></video>` : '';
    stage = `<div class="dr-stage ${ready ? 'ready' : 'earning'}">${crateStage(dr)}${ready ? '<span class="chip green dr-ready">Ready</span>' : ''}${preload}</div>
      ${ready ? '' : `<div class="dr-progress"><span class="label">Watched today</span><span class="bar"><i style="width:${(dr.minutes / Math.max(1, dr.threshold)) * 100}%"></i></span><span><b>${dr.minutes}</b> of ${dr.threshold} min</span></div>`}`;
    middle = `${factsRow(dr)}${rarityTable(dr)}
      <div class="dr-dupe-line">${dupeRing(dr.duplicateChance)}<span><b>${fmtChance(dr.duplicateChance)} chance of a duplicate</b><small>${n(dr.collection?.owned)} of Kick’s ${n(dr.collection?.total)} cards are yours</small></span></div>`;
    actions = `<div class="dr-actions">${claimButton({ ...dr, daily: true, theme: 'daily', minutes: dr.minutes, threshold: dr.threshold, watching: dr.watching || left === 0 })}</div>`;
  }
  return `<div class="dr-card at-${where} state-${dr.state} ${crates.length > 1 ? 'tabbed' : ''} ${revealing ? 'revealing' : ''}">${top}${stage}
    <div class="dr-body">${middle}</div>${actions}
    <div class="dr-reveal" hidden></div></div>`;
}

/** The day an event's crate is offered until, as people say it: "Nov 1". */
const fmtCrateDay = (t) => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });

/** When a prize was won, as people say it: "Today", "Yesterday", "Thu", "Oct 12". */
function fmtWonDay(t) {
  if (!t) return '';
  const day = (x) => new Date(x).setHours(0, 0, 0, 0);
  const ago = Math.round((day(Date.now()) - day(t)) / 86_400_000);
  if (ago <= 0) return 'Today';
  if (ago === 1) return 'Yesterday';
  return ago < 7 ? new Date(t).toLocaleDateString([], { weekday: 'short' }) : fmtCrateDay(t);
}

/** A prize in words: "Hoot Hoot · Uncommon emote", or the watch time it gave. */
function prizeLine(won) {
  const w = won?.winner;
  if (!w) return '';
  if (w.xp) return `<b>Level progress</b><span class="dr-sub"><span class="dr-xp">+${fmtLeft(w.xp)}</span> watch time${won.levelTo ? ` towards Level ${n(won.levelTo)}` : ''}</span>`;
  const status = won.duplicate ? '<span class="chip">Duplicate</span>' : '<span class="chip green new">New</span>';
  return w.name ? `<b>${esc(w.name)}</b><span>${cardKind(w)}</span>${status}` : `<b>${cardKind(w)}</b>${status}`;
}

/** The prizes an event has given, a slot a day: newest first, the empty days still to come. */
function prizeStrip(e, where) {
  const prizes = e.prizes ?? [];
  if (!prizes.length) return '';
  const slots = Math.max(prizes.length ? 1 : 0, Math.min(e.days ?? prizes.length, where === 'tray' ? 7 : 8));
  const shown = prizes.slice(0, slots);
  const tiles = shown.map((p) => `<span class="dr-won-tile r-${esc(p.rarity)}" data-tip="${esc([p.name, cardKind(p), fmtWonDay(p.at)].filter(Boolean).join(' · '))}">${img(p.image, '', p.name || cardKind(p))}<small>${fmtWonDay(p.at)}</small></span>`);
  const empty = '<span class="dr-won-tile empty"></span>'.repeat(Math.max(0, slots - shown.length));
  return `<div class="dr-won"><div class="dr-won-head"><span>Won this event</span><b>${n(prizes.length)}</b><span class="spacer"></span>${e.days ? `<span class="dr-won-days">${n(Math.min(prizes.length, e.days))} of ${n(e.days)} days</span>` : ''}</div>
    <div class="dr-won-row">${tiles.join('')}${empty}</div></div>`;
}

/** An event's odds: Kick gives no list of its prizes, so no count of which are yours. */
function crateOdds(e) {
  if (!e.odds?.length) return '';
  return `<div class="dr-rarities crate"><div class="dr-rarity head"><span>Rarity</span><span>Chance</span><span></span></div>
    ${e.odds.map((o) => `<div class="dr-rarity r-${esc(o.rarity)}"><span class="name"><i></i>${rarityName(o.rarity)}</span><span class="pct">${fmtChance(o.chance)}</span><span class="own"><span class="bar"><i style="width:${Math.max(2, o.chance * 100).toFixed(1)}%"></i></span></span></div>`).join('')}</div>`;
}

/**
 * Another crate's page: an event's (Trick or Treat, say: its own name, words, videos and odds,
 * and a theme of colours worked out from them) or the one-time Welcome Reward. The same parts as
 * the daily one's, and what's its own: its description, the days it runs, what it has given.
 */
function crateCard(dr, e, crates, { where, revealing }) {
  const theme = esc(e.theme ?? 'event');
  const daily = e.until && e.endsAt && e.until > e.endsAt;
  const top = cardHead(crates, e.id, { where, title: e.name || 'Event reward', sub: crateSub(e.state, e.endsAt), theme });
  const art = e.media?.idle ? `<video class="dr-crate" src="${esc(e.media.idle)}" autoplay loop muted playsinline data-fallback="crate"></video>` : crateArt('idle');
  let stage;
  if (e.state === 'claimed') {
    const w = e.won?.winner;
    if (w?.xp) stage = `<div class="dr-stage won xp"><div class="dr-won-glow"></div><div class="dr-xp-big">${icon('trophy')}<b>+${fmtLeft(w.xp)}</b><span>watch time</span></div></div>`;
    else if (w?.image) stage = `<div class="dr-stage won crate r-${esc(w.rarity)}"><div class="dr-won-glow"></div>${img(w.image, 'dr-won-card square', w.name || cardKind(w))}</div>`;
    else stage = `<div class="dr-stage crate">${crateArt('dim')}<div class="dr-stage-msg">${icon('check')}Claimed today${e.won?.by === 'elsewhere' ? ' on Kick' : ''}.</div></div>`;
    if (w) stage += `<div class="dr-result">${prizeLine(e.won)}</div>`;
  } else {
    const ready = e.state === 'ready';
    const preload = ready && e.media?.unbox ? `<video class="dr-preload" src="${esc(e.media.unbox)}" preload="auto" muted hidden></video>` : '';
    stage = `<div class="dr-stage crate ${ready ? 'ready' : 'earning'}">${art}${ready ? '<span class="chip dr-ready">Ready</span>' : ''}${preload}</div>
      ${ready || e.condition !== 'watch_time_minutes' ? '' : `<div class="dr-progress"><span class="label">Watched today</span><span class="bar"><i style="width:${(e.minutes / Math.max(1, e.threshold)) * 100}%"></i></span><span><b>${fmtLeft(e.minutes)}</b> of ${fmtHours(e.threshold)}</span></div>`}`;
  }
  const facts = [
    e.condition === 'watch_time_minutes' ? `<span class="dr-fact" data-tip="Watch time it needs, on any Kick stream">${icon('clock')}<b>${fmtHours(e.threshold)}</b> a day</span>` : '',
    daily ? `<span class="dr-fact grow">${chestMark()}New one daily until <b>${fmtCrateDay(e.until - 1)}</b></span>` : '',
  ].join('');
  const left = Math.max(0, e.threshold - e.minutes);
  const actions =
    e.state === 'claimed'
      ? `${e.won?.replay ? `<button class="btn" data-action="reward-replay" data-id="${esc(e.id)}">${icon('play')} Replay</button>` : ''}<button class="btn" data-action="reward-prizes" data-tip="What you’ve won, on kick.com">${icon('external')} View on Kick</button>`
      : e.condition === 'watch_time_minutes' || e.state === 'ready'
        ? claimButton({ ...e, theme: e.theme ?? 'event', watching: dr.watching || left === 0, claiming: dr.claiming })
        : `<button class="btn" data-action="reward-kick">${icon('external')} Open on Kick</button>`;
  return `<div class="dr-card at-${where} crate theme-${theme} state-${esc(e.state)} ${crates.length > 1 ? 'tabbed' : ''} ${revealing ? 'revealing' : ''}">${top}
    ${e.description ? `<p class="dr-desc">${esc(e.description)}</p>` : ''}${stage}
    <div class="dr-body">${facts ? `<div class="dr-facts">${facts}</div>` : ''}${crateOdds(e)}${prizeStrip(e, where)}</div>
    <div class="dr-actions">${actions}</div>
    <div class="dr-reveal" hidden></div></div>`;
}

/**
 * What a reveal plays: the daily crate's video, or the event crate `id`'s (its own, or our crate
 * in its colours), and its name over the prize.
 */
function revealFor(dr, id) {
  const e = id ? (dr?.extras ?? []).find((x) => x.id === id) : null;
  return e ? { unbox: e.media?.unbox ?? null, theme: e.theme ?? 'event', title: e.name || null } : { unbox: dr?.media?.unbox ?? null, theme: null, title: null };
}

// ------------------------------------------------------------------ the reveal

// The prize stays on show until Done (or Esc, or the tray's Back): revealDone() ends it.
let finishReveal = null;
function revealDone() {
  finishReveal?.();
  finishReveal = null;
}

/** Puts the card back as it was before a reveal (a redraw won't, when nothing else changed). */
function endReveal(card) {
  finishReveal = null;
  if (!card) return;
  card.classList.remove('revealing');
  const layer = card.querySelector('.dr-reveal');
  if (!layer) return;
  layer.hidden = true;
  layer.replaceChildren();
  delete layer.dataset.phase;
  delete layer.dataset.instant;
  layer.className = 'dr-reveal';
}

const REEL = { speed: 3.5, ease: 'cubic-bezier(0.18, 0.58, 0.12, 1)', pulse: 'cubic-bezier(0.45, 0.05, 0.55, 0.95)' };
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Kick's reveal, timed like kick.com: the crate opens, the reel slows onto the winner, the
 * winner grows, then its card. Instant crates (an event's) open straight onto the prize. The prize
 * then stays until Done: resolves when it's dismissed.
 * @param {HTMLElement} root the card's .dr-reveal layer
 * @param {{ items: {image:string, rarity:string}[], winnerIndex: number, winner: object, revealType?: string }} claim
 * @param {{ unbox?: string|null, tile?: number, theme?: string|null, title?: string|null }} o theme and title: an event crate's
 */
async function playReveal(root, claim, { unbox = null, tile = 120, theme = null, title = null } = {}) {
  root.hidden = false;
  root.className = `dr-reveal ${theme ? `crate theme-${esc(theme)}` : ''}`;
  root.style.setProperty('--tile', `${tile}px`);
  const fast = reduceMotion();
  const items = claim.items ?? [];
  const tiles = [...items, ...items, items[0]].filter(Boolean);
  const stop = items.length + claim.winnerIndex;
  const w = claim.winner ?? {};
  const instant = claim.revealType === 'instant' || items.length < 2;
  root.innerHTML = `<div class="dr-reveal-bg"></div>
    <div class="dr-unbox">${unbox ? `<video src="${esc(unbox)}" muted playsinline></video>` : crateArt('opening')}</div>
    <div class="dr-reel"><div class="dr-reel-track">${tiles.map((t, i) => `<div class="dr-tile r-${esc(t.rarity)}" data-i="${i}">${img(t.image)}</div>`).join('')}</div><div class="dr-reel-mark"></div></div>
    <div class="dr-winner r-${esc(w.rarity ?? 'common')} ${w.square ? 'square' : ''} ${w.xp ? 'xp' : ''}">${title ? `<div class="dr-winner-title">${chestMark()}${esc(title)}</div>` : ''}
      <div class="dr-won-wrap"><div class="dr-rays"></div><div class="dr-won-glow"></div>${w.xp ? `<div class="dr-xp-big">${icon('trophy')}<b>+${fmtLeft(w.xp)}</b><span>watch time</span></div>` : img(w.image, 'dr-won-card', w.name || cardKind(w))}</div>
      <div class="dr-winner-caption">${w.xp ? `<b>Level progress</b>${claim.levelTo ? `<span>towards Level ${n(claim.levelTo)}</span>` : ''}` : w.name ? `<b>${esc(w.name)}</b><span>${cardKind(w)}</span>${claim.duplicate ? '<span class="chip">Duplicate</span>' : '<span class="chip green new">New</span>'}` : winnerLine({ winner: w, duplicate: !!claim.duplicate }, { short: true })}</div>
      <button class="btn primary dr-done" data-action="reward-done">Done</button></div>`;
  const held = () => {
    root.dataset.phase = 'celebrate';
    return new Promise((resolve) => {
      finishReveal = resolve;
    });
  };
  if (fast) return held();
  const reel = root.querySelector('.dr-reel');
  const track = root.querySelector('.dr-reel-track');
  // An animation's promise, or its own length (plus a little) if the window stops painting:
  // a hidden tray popover mustn't leave the reveal hanging.
  const done = (anim, ms) => Promise.race([anim.finished.catch(() => {}), wait(ms + 400)]);

  // openBox: the crate opens; the reel fades in over the video's last second (6 s at most).
  root.dataset.phase = 'openBox';
  const video = root.querySelector('.dr-unbox video');
  const opened = video
    ? new Promise((resolve) => {
        video.addEventListener('timeupdate', () => video.currentTime >= (video.duration || 2.7) - 1 && resolve());
        video.addEventListener('ended', resolve, { once: true });
        video.addEventListener('error', resolve, { once: true });
        video.play().catch(resolve);
      })
    : wait(1900); // our crate's opening (daily-reward.css)
  await Promise.race([opened, wait(6000)]);
  // An instant crate: no reel. The prize bursts out of the open crate.
  if (instant) {
    root.dataset.instant = '';
    return held();
  }

  // spin: the reel runs at 3.5 tiles a second, easing onto the winner in the second copy.
  // The tile under the mark is ×1.2, the ones beside it ×0.8, as on kick.com.
  root.dataset.phase = 'spin';
  const step = tile + 12;
  const centre = reel.clientWidth / 2 - tile / 2;
  const to = -(stop * step) + centre;
  const ms = Math.max(2500, (stop / REEL.speed) * 1000);
  const els = [...track.children];
  let spinning = true;
  const magnify = () => {
    const x = new DOMMatrixReadOnly(getComputedStyle(track).transform).m41;
    for (const [i, el] of els.entries()) {
      const d = Math.abs(i * step + x - centre) / step;
      el.style.transform = `scale(${(0.8 + 0.4 * Math.max(0, 1 - d)).toFixed(3)})`;
    }
    if (spinning) requestAnimationFrame(magnify);
  };
  requestAnimationFrame(magnify);
  await done(track.animate([{ transform: `translateX(${centre}px)` }, { transform: `translateX(${to}px)` }], { duration: ms, easing: REEL.ease, fill: 'forwards' }), ms);
  spinning = false;

  // handoff: the winner dips to ×0.9 and grows to ×1.3; the reel fades and shrinks away.
  root.dataset.phase = 'handoff';
  const won = els[stop];
  won?.classList.add('won');
  if (won) await done(won.animate([{ transform: 'scale(1.2)' }, { transform: 'scale(0.9)' }, { transform: 'scale(1.3)' }], { duration: 1400, easing: REEL.pulse, fill: 'forwards' }), 1400);
  await done(reel.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.92)' }], { duration: 700, easing: REEL.pulse, fill: 'forwards' }), 700);

  // celebrate: the winner's card, until Done.
  return held();
}
