/* global icon, esc, img, fmtDur, fmtClock, MIN */
// Kick's Daily Reward, drawn the same way on the dashboard (the title-bar chest, its card, the
// Daily tab, the collection) and in the tray: watch an hour, open a crate, a reel picks a card.
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

/** A chance as people say it: 55%, 4.7%, 0.3%, and "1 in 200,000" once it's tiny. */
function fmtChance(fraction) {
  const p = (fraction ?? 0) * 100;
  if (p <= 0) return '0%';
  if (p < 0.01) return `1 in ${Math.round(1 / fraction).toLocaleString()}`;
  if (p < 1) return `${Number(p.toPrecision(2))}%`;
  return `${Number(p.toFixed(p < 10 ? 1 : 0))}%`;
}

// The chest: a stroke icon like the rest of the set. Its lid is its own group, so the ready
// chest can lift it and let the glow out.
function chestMark(cls = '') {
  return `<svg class="icon chest ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <ellipse class="chest-glow" cx="12" cy="11" rx="7.5" ry="2.4" stroke="none"/>
    <path d="M3 11h18v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M7.5 11v8.5M16.5 11v8.5"/>
    <g class="chest-lid"><path d="M3 11V8.5A3.5 3.5 0 0 1 6.5 5h11A3.5 3.5 0 0 1 21 8.5V11"/><path d="M7.5 5.5V11M16.5 5.5V11"/></g>
    <rect class="chest-latch" x="10.5" y="9.5" width="3" height="4" rx="1"/>
    <g class="chest-sparks" stroke="none"><path d="M5 .6l.55 1.3 1.3.55-1.3.55L5 4.3l-.55-1.3-1.3-.55 1.3-.55z"/><path d="M19.5 0l.45 1.05 1.05.45-1.05.45-.45 1.05-.45-1.05-1.05-.45 1.05-.45z"/></g>
  </svg>`;
}

/** Our own crate, for demo mode and whenever Kick's video doesn't play. */
function crateArt(cls = '') {
  return `<svg class="dr-crate-art ${cls}" viewBox="0 0 240 170" aria-hidden="true">
    <defs>
      <linearGradient id="dr-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2f37"/><stop offset="1" stop-color="#101318"/></linearGradient>
      <linearGradient id="dr-lid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#343a44"/><stop offset="1" stop-color="#1b1f26"/></linearGradient>
      <radialGradient id="dr-shine" cx=".5" cy="0" r=".9"><stop offset="0" stop-color="#53fc18" stop-opacity=".55"/><stop offset="1" stop-color="#53fc18" stop-opacity="0"/></radialGradient>
    </defs>
    <ellipse cx="120" cy="158" rx="84" ry="8" fill="#000" opacity=".55"/>
    <ellipse class="crate-burst" cx="120" cy="66" rx="92" ry="40" fill="url(#dr-shine)"/>
    <g class="crate-body">
      <rect x="40" y="66" width="160" height="86" rx="14" fill="url(#dr-body)" stroke="rgba(255,255,255,.12)"/>
      <rect x="40" y="66" width="160" height="10" fill="#0b0d10" opacity=".6"/>
      <path d="M76 92v44M100 92v44M140 92v44M164 92v44" stroke="rgba(255,255,255,.07)" stroke-width="10" stroke-linecap="round"/>
      <rect x="106" y="82" width="28" height="34" rx="7" fill="#0d1014" stroke="#53fc18" stroke-opacity=".7" stroke-width="2"/>
      <circle cx="120" cy="99" r="5" fill="#53fc18"/>
    </g>
    <g class="crate-lid">
      <path d="M36 66V52a18 18 0 0 1 18-18h132a18 18 0 0 1 18 18v14z" fill="url(#dr-lid)" stroke="rgba(255,255,255,.14)"/>
      <rect x="62" y="44" width="116" height="8" rx="4" fill="#0b0d10"/>
      <g fill="#53fc18"><rect x="70" y="46" width="22" height="4" rx="2"/><circle cx="104" cy="48" r="2"/><circle cx="114" cy="48" r="2"/><circle cx="124" cy="48" r="2"/><circle cx="134" cy="48" r="2"/><circle cx="144" cy="48" r="2" opacity=".4"/><circle cx="154" cy="48" r="2" opacity=".4"/><circle cx="164" cy="48" r="2" opacity=".4"/></g>
    </g>
  </svg>`;
}

/** The crate on the card: Kick's looping video, or our own crate. */
function crateStage(dr) {
  const url = dr.media?.idle;
  return url ? `<video class="dr-crate" src="${esc(url)}" autoplay loop muted playsinline data-fallback="crate"></video>` : crateArt('idle');
}

const rarityChip = (r, extra = '') => `<span class="chip rarity r-${esc(r)}${extra}"><i></i>${rarityName(r)}</span>`;

/** A card's name, or what it is when Kick gives no name. */
const cardName = (c) => c?.name || (c?.type === 'badge' ? 'A badge' : 'An emote');

/** What a claimed card was: new, or a duplicate turned into level progress. */
function winnerLine(t, { short = false } = {}) {
  if (!t?.winner) return '';
  const name = `<b>${esc(cardName(t.winner))}</b>`;
  if (!t.duplicate) return `${name} ${rarityChip(t.winner.rarity)}<span class="chip green new">New</span>`;
  const xp = t.xpMinutes ? `<span class="dr-xp">+${fmtDur(t.xpMinutes * MIN)}</span> watch time${t.levelTo ? ` to Level ${t.levelTo}` : ''}` : 'Level progress';
  return short ? `${name} ${rarityChip(t.winner.rarity)}<span class="chip">Duplicate</span>` : `<span class="dr-dupe">You already have ${name} ${rarityChip(t.winner.rarity)}</span><span class="dr-sub">${xp}</span>`;
}

// ------------------------------------------------------------------ the chest button

/** What the chest's tooltip says. */
function chestTip(dr) {
  if (dr.state === 'ready') return `Daily reward is ready. Claim before ${fmtClock(dr.endsAt)}`;
  if (dr.state === 'earning') return `Daily reward · ${dr.minutes} of ${dr.threshold} min\n${dr.threshold - dr.minutes} min to go${dr.watching ? '' : ' (not watching)'}`;
  if (dr.state === 'claimed' && dr.today?.winner) return `Today: ${cardName(dr.today.winner)}, ${rarityName(dr.today.winner.rarity).toLowerCase()}${dr.today.duplicate ? ' (a duplicate)' : ''}\nNext one in ${fmtDur(dr.endsAt - Date.now())}`;
  if (dr.state === 'unavailable') return 'Kick’s daily reward isn’t answering right now';
  return 'Daily reward';
}

/**
 * The chest: a ring that fills over the hour, a glowing "Claim reward" chip when it's ready,
 * and a full ring in the winner's colour once claimed.
 * @param {object} dr the daily reward state
 * @param {{ where?: 'titlebar'|'tray', tight?: boolean, open?: boolean }} o
 */
function rewardChest(dr, { where = 'titlebar', tight = false, open = false } = {}) {
  if (!dr || dr.state === 'signed-out' || dr.state === 'hidden') return '';
  const ready = dr.state === 'ready';
  const frac = dr.state === 'claimed' ? 1 : dr.state === 'earning' ? Math.min(1, dr.minutes / Math.max(1, dr.threshold)) : 0;
  const tone = dr.state === 'claimed' ? `r-${esc(dr.today?.winner?.rarity ?? 'common')}` : '';
  const c = 2 * Math.PI * 9;
  const ring = `<svg class="dr-ring" viewBox="0 0 22 22"><circle cx="11" cy="11" r="9" stroke="rgba(255,255,255,.08)" stroke-width="2" fill="none"/>
    <circle class="dr-ring-value" cx="11" cy="11" r="9" stroke-width="2" fill="none" stroke-linecap="round" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - frac)).toFixed(2)}" transform="rotate(-90 11 11)"/></svg>`;
  const cls = `dr-chest ${where} state-${esc(dr.state)} ${tone} ${open ? 'open' : ''} ${ready && !tight && where === 'titlebar' ? 'chip' : ''}`;
  const label = ready && !tight && where === 'titlebar' ? '<span>Claim reward</span>' : '';
  return `<button class="${cls}" data-action="reward-open" data-tip="${esc(chestTip(dr))}" aria-label="Daily reward">${ready ? '' : ring}${chestMark()}${label}</button>`;
}

// ------------------------------------------------------------------ the card

/** Rarity by rarity: the chance of each, and how much of it is yours. */
function rarityTable(dr, { won = false, filter = null } = {}) {
  const by = dr.collection?.byRarity ?? {};
  const odds = Object.fromEntries((dr.odds ?? []).map((o) => [o.rarity, o.chance]));
  const wins = dr.stats?.byRarity ?? {};
  return `<div class="dr-rarities ${won ? 'with-wins' : ''}">
    <div class="dr-rarity head"><span>Rarity</span><span>Chance</span><span class="own">Yours</span>${won ? '<span>Won</span><span>Dupes</span>' : ''}</div>
    ${RARITIES.map(([id, name]) => {
      const c = by[id] ?? { owned: 0, total: 0 };
      const w = wins[id] ?? { won: 0, dupes: 0 };
      const pick = filter ? ` data-action="col-rarity" data-id="${filter === id ? 'all' : id}" data-tip="${filter === id ? 'Show every rarity' : `Show only ${name.toLowerCase()} cards`}"` : '';
      return `<div class="dr-rarity r-${id} ${filter === id ? 'picked' : ''} ${filter ? 'pickable' : ''}"${pick}><span class="name"><i></i>${name}</span><span class="pct">${odds[id] == null ? '—' : fmtChance(odds[id])}</span>
        <span class="own"><span class="bar"><i style="width:${c.total ? (c.owned / c.total) * 100 : 0}%"></i></span><span class="count"><b>${c.owned}</b>/${c.total}</span></span>
        ${won ? `<span class="num">${w.won || '—'}</span><span class="num">${w.dupes || '—'}</span>` : ''}</div>`;
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
    <span class="dr-fact" data-tip="Days in a row you’ve claimed the daily reward">${icon('bolt')}<b>${dr.streak ?? 0}-day</b> streak</span>
    ${
      lv
        ? `<span class="dr-fact level" data-tip="Your Kick level. Duplicates turn into progress towards the next one">${lv.badge ? img(lv.badge, 'dr-level-badge') : icon('trophy')}<b>Level ${lv.level}</b>
          <span class="bar"><i style="width:${lv.toNext ? Math.min(100, (lv.progress / (lv.progress + lv.toNext)) * 100) : 0}%"></i></span></span>`
        : ''
    }
  </div>`;
}

/**
 * The daily reward card: earning, ready or claimed, with the claim and the reveal.
 * @param {object} dr the daily reward state
 * @param {{ where?: 'pop'|'tray', revealing?: boolean }} o
 */
function rewardCard(dr, { where = 'pop', revealing = false } = {}) {
  if (!dr) return '';
  const left = Math.max(0, dr.threshold - dr.minutes);
  const head = {
    earning: `Resets at ${fmtClock(dr.endsAt)}`,
    ready: `Claim before ${fmtClock(dr.endsAt)}`,
    claimed: `Next one in ${fmtDur(dr.endsAt - Date.now())}`,
  }[dr.state];
  const close = where === 'tray' ? `<button class="btn sm icon-only ghost" data-action="reward-back" data-tip="Back">${icon('chevronLeft')}</button>` : '';
  const x = where === 'pop' ? `<button class="btn sm icon-only ghost" data-action="reward-close" data-tip="Close (Esc)">${icon('x')}</button>` : '';
  const top = `<div class="dr-head">${close}${chestMark()}<b>Daily reward</b>${head ? `<span class="dr-head-sub">${head}</span>` : ''}<span class="spacer"></span>${x}</div>`;

  if (dr.state === 'unavailable' || dr.state === 'loading') {
    return `<div class="dr-card ${where} state-${dr.state}">${top}
      <div class="dr-stage">${crateArt('idle dim')}<div class="dr-stage-msg">${dr.state === 'loading' ? '<span class="spinner"></span>Asking Kick…' : `${icon('alert')}Kick’s daily reward isn’t answering. Pear Drops tries again in a few minutes.`}</div></div>
      <div class="dr-actions"><button class="btn" data-action="reward-kick">${icon('external')} Open on Kick</button></div></div>`;
  }

  let stage;
  let middle;
  let actions;
  if (dr.state === 'claimed') {
    const t = dr.today ?? {};
    stage = `<div class="dr-stage won r-${esc(t.winner?.rarity ?? 'common')}"><div class="dr-won-glow"></div>${t.winner ? img(t.winner.image, 'dr-won-card', cardName(t.winner)) : ''}</div>
      <div class="dr-result">${winnerLine(t)}</div>`;
    middle = `${factsRow(dr)}${rarityTable(dr)}
      <div class="dr-dupe-line">${dupeRing(dr.duplicateChance)}<span><b>${fmtChance(dr.duplicateChance)} chance of a duplicate</b><small>Tomorrow, with ${dr.collection?.owned ?? 0} of Kick’s ${dr.collection?.total ?? 0} cards yours</small></span></div>`;
    actions = `<div class="dr-actions">${t.roulette ? `<button class="btn" data-action="reward-replay">${icon('play')} Replay</button>` : ''}<button class="btn" data-action="reward-insights">${icon('pulse')} Insights</button></div>`;
  } else {
    const ready = dr.state === 'ready';
    // While it's ready, the opening video loads in the background, so the reveal starts at once.
    const preload = ready && dr.media?.unbox ? `<video class="dr-preload" src="${esc(dr.media.unbox)}" preload="auto" muted hidden></video>` : '';
    stage = `<div class="dr-stage ${ready ? 'ready' : 'earning'}">${crateStage(dr)}${ready ? '<span class="chip green dr-ready">Ready</span>' : ''}${preload}</div>
      ${ready ? '' : `<div class="dr-progress"><span class="label">Watched today</span><span class="bar"><i style="width:${(dr.minutes / Math.max(1, dr.threshold)) * 100}%"></i></span><span><b>${dr.minutes}</b> of ${dr.threshold} min</span></div>`}`;
    middle = `${factsRow(dr)}${rarityTable(dr)}
      <div class="dr-dupe-line">${dupeRing(dr.duplicateChance)}<span><b>${fmtChance(dr.duplicateChance)} chance of a duplicate</b><small>You have ${dr.collection?.owned ?? 0} of Kick’s ${dr.collection?.total ?? 0} cards</small></span></div>`;
    const label = ready ? 'Claim' : dr.watching ? `Claim in ${left} min` : `Watch ${left} more min`;
    actions = `<div class="dr-actions"><button class="btn primary lg dr-claim" data-action="reward-claim" ${ready ? '' : 'disabled'}>${label}</button></div>`;
  }
  const extras = (dr.extras ?? []).map(
    (e) => `<div class="dr-extra">${chestMark()}<span><b>${esc(e.name)}</b> ${e.state === 'ready' ? 'is ready' : `${e.minutes} of ${e.threshold} min`}</span>
      ${e.state === 'ready' ? `<button class="btn sm primary" data-action="reward-claim" data-id="${esc(e.id)}">Claim</button>` : ''}</div>`,
  );
  return `<div class="dr-card ${where} state-${dr.state} ${revealing ? 'revealing' : ''}">${top}${stage}
    <div class="dr-body">${middle}${extras.join('')}</div>${actions}
    <div class="dr-reveal" hidden></div></div>`;
}

// ------------------------------------------------------------------ the reveal

const REEL = { speed: 3.5, ease: 'cubic-bezier(0.18, 0.58, 0.12, 1)', pulse: 'cubic-bezier(0.45, 0.05, 0.55, 0.95)' };
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Kick's reveal, timed like kick.com: the crate opens, the reel slows onto the winner, the
 * winner grows, then its card. Instant crates skip the reel. Resolves when it's over.
 * @param {HTMLElement} root the card's .dr-reveal layer
 * @param {{ items: {image:string, rarity:string}[], winnerIndex: number, winner: object, revealType?: string }} claim
 * @param {{ unbox?: string|null, tile?: number }} o
 */
async function playReveal(root, claim, { unbox = null, tile = 120 } = {}) {
  root.hidden = false;
  root.style.setProperty('--tile', `${tile}px`);
  const fast = reduceMotion();
  const tiles = [...claim.items, ...claim.items, claim.items[0]].filter(Boolean);
  const stop = claim.items.length + claim.winnerIndex;
  const w = claim.winner ?? {};
  root.innerHTML = `<div class="dr-reveal-bg"></div>
    <div class="dr-unbox">${unbox ? `<video src="${esc(unbox)}" muted playsinline></video>` : crateArt('opening')}</div>
    <div class="dr-reel"><div class="dr-reel-track">${tiles.map((t, i) => `<div class="dr-tile r-${esc(t.rarity)}" data-i="${i}">${img(t.image)}</div>`).join('')}</div><div class="dr-reel-mark"></div></div>
    <div class="dr-winner r-${esc(w.rarity ?? 'common')}"><div class="dr-won-glow"></div>${img(w.image, 'dr-won-card')}
      <div class="dr-winner-caption">${winnerLine({ winner: w, duplicate: !!claim.consolation }, { short: true })}</div></div>`;
  const reel = root.querySelector('.dr-reel');
  const track = root.querySelector('.dr-reel-track');
  if (fast || claim.revealType === 'instant' || claim.items.length < 2) {
    root.dataset.phase = 'celebrate';
    await wait(fast ? 0 : 400);
    return;
  }
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
    : wait(1600);
  await Promise.race([opened, wait(6000)]);

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

  // celebrate: the winner's card.
  root.dataset.phase = 'celebrate';
  await wait(2200);
}

// ------------------------------------------------------------------ insights (the Daily tab)

const DAY_TIPS = {
  claimed: (d) => `${cardName(d.winner)}, ${rarityName(d.winner?.rarity).toLowerCase()}${d.duplicate ? ' (duplicate)' : ''}`,
  missed: () => 'Ready, but not claimed before the reset',
  short: (d) => `${d.minutes} of 60 min watched`,
  none: () => 'Pear Drops wasn’t running',
  today: (d) => `Today · ${d.minutes ?? 0} of 60 min`,
};

/** The last 30 days, a square each: the card's colour, a red ring for a missed one. */
function daysStrip(days = []) {
  return `<div class="dr-days">${days
    .map((d) => {
      const tip = `${new Date(`${d.day}T12:00:00Z`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}\n${(DAY_TIPS[d.today ? 'today' : d.state] ?? DAY_TIPS.none)(d)}`;
      const fill = d.state === 'short' || d.today ? `<i style="height:${Math.min(100, ((d.minutes ?? 0) / 60) * 100)}%"></i>` : '';
      return `<span class="dr-day ${d.state} ${d.today ? 'today' : ''} ${d.winner ? `r-${esc(d.winner.rarity)}` : ''}" data-tip="${esc(tip)}">${fill}</span>`;
    })
    .join('')}</div>`;
}

const BY = { you: '', auto: 'Automatically', multiview: 'In Stream Multiview', elsewhere: 'On kick.com' };

/** A claim in the list: the card, new or a duplicate (and how many times), and when. */
function claimRow(c) {
  const when = new Date(c.at).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const what = c.duplicate ? `Duplicate${c.times > 1 ? ` · ${c.times}${['th', 'st', 'nd', 'rd'][c.times % 10 > 3 || Math.floor(c.times / 10) === 1 ? 0 : c.times % 10]} time` : ''}${c.xpMinutes ? ` · +${fmtDur(c.xpMinutes * MIN)} to levels` : ''}` : 'New to your collection';
  return `<div class="dr-claim-row">${img(c.winner?.image, `dr-thumb r-${esc(c.winner?.rarity ?? 'common')}`)}
    <div class="who"><b>${esc(cardName(c.winner))}</b>${rarityChip(c.winner?.rarity ?? 'common', ' tiny')}<span>${what}</span></div>
    <div class="when">${when}${BY[c.by] ? `<span>${BY[c.by]}</span>` : ''}</div></div>`;
}

/** How your duplicates compare with the odds. */
function luckLine(s) {
  if (!s?.claims) return '<span>Your first claim starts the record.</span>';
  const rate = s.duplicates / s.claims;
  const diff = rate - (s.expectedDupes ?? rate);
  const word = s.claims < 5 ? '' : diff < -0.05 ? '<span class="chip green tiny">Luckier than the odds</span>' : diff > 0.05 ? '<span class="chip amber tiny">Unluckier than the odds</span>' : '<span class="chip tiny">As expected</span>';
  return `<span><b>${s.duplicates}</b> of ${s.claims} claims were duplicates: <b>${fmtChance(rate)}</b>, ${fmtChance(s.expectedDupes)} expected</span>${word}`;
}

/** The Daily tab on the dashboard: today, streak, level and collection, the last 30 days, every claim. */
function dailyPanel(dr) {
  if (!dr || dr.state === 'signed-out') return '<div class="empty">Sign in to Kick to see your daily reward.</div>';
  const s = dr.stats ?? {};
  const lv = dr.level;
  const today =
    dr.state === 'claimed'
      ? `<b>${rarityName(dr.today?.winner?.rarity)}</b><span>next in ${fmtDur(dr.endsAt - Date.now())}</span>`
      : dr.state === 'ready'
        ? `<b class="green">Ready</b><span>until ${fmtClock(dr.endsAt)}</span>`
        : `<b>${dr.minutes}<small>/${dr.threshold}m</small></b><span>${dr.threshold - dr.minutes}m to go</span>`;
  const tile = (ic, cls, label, body, { extra = '', action = '', tip = '' } = {}) =>
    `<${action ? 'button' : 'div'} class="dr-tile-stat ${extra}" ${action ? `data-action="${action}"` : ''} ${tip ? `data-tip="${esc(tip)}"` : ''}><div class="stat-head"><span class="stat-icon ${cls}">${ic}</span>${label}</div>${body}</${action ? 'button' : 'div'}>`;
  const rate = s.claims ? `<b>${s.duplicates}</b> duplicate${s.duplicates === 1 ? '' : 's'} · <b>${fmtChance(s.duplicates / s.claims)}</b>${s.expectedDupes != null ? ` <span class="muted">(${fmtChance(s.expectedDupes)} expected)</span>` : ''}` : '';
  return `<div class="dr-panel">
    <div class="dr-tiles">
      ${tile(chestMark(), 'green', 'Today', today, { extra: `${dr.state === 'ready' ? 'ready' : ''} ${dr.state === 'claimed' ? `r-${esc(dr.today?.winner?.rarity ?? 'common')} won` : ''}`, action: 'reward-open', tip: 'Open the daily reward' })}
      ${tile(icon('bolt'), 'gold', 'Streak', `<b>${dr.streak ?? 0}<small> days</small></b><span>best ${Math.max(s.bestStreak ?? 0, dr.streak ?? 0)}</span>`)}
      ${tile(icon('trophy'), 'violet', 'Level', lv ? `<b>${lv.level}</b><span class="bar" data-tip="${lv.progress} of ${lv.progress + lv.toNext} XP to Level ${lv.level + 1}"><i style="width:${lv.toNext ? Math.min(100, (lv.progress / (lv.progress + lv.toNext)) * 100) : 0}%"></i></span>` : '<b>—</b>')}
      ${tile(icon('sparkle'), 'blue', 'Cards', `<b>${dr.collection?.owned ?? 0}<small>/${dr.collection?.total ?? 0}</small></b><span>${dr.collection?.total ? Math.round((dr.collection.owned / dr.collection.total) * 100) : 0}% done</span>`, { action: 'reward-collection', tip: 'Every card, with your odds by rarity' })}
    </div>
    <div class="dr-section">
      <div class="dr-section-head"><b>Last 30 days</b><span class="dr-legend"><i class="claimed"></i>Claimed<i class="missed"></i>Missed<i class="short"></i>Under an hour</span></div>
      ${daysStrip(s.days)}
    </div>
    <div class="dr-section grow">
      <div class="dr-section-head"><b>Claims</b><span class="muted">${s.claims ?? 0}</span><span class="spacer"></span><span class="dr-rate">${rate}</span></div>
      <div class="dr-claims">${(dr.recent ?? []).map(claimRow).join('') || '<div class="side-note">Every claim shows here, with its duplicates counted. Kick keeps no list of its own.</div>'}</div>
    </div>
  </div>`;
}

// ------------------------------------------------------------------ the collection

/**
 * Every card Kick has: yours in colour, the rest dimmed, with how many times you've won each.
 * @param {{ cards: object[], wins: Record<string, number> }} col
 * @param {{ rarity?: string, show?: 'all'|'owned'|'missing' }} filter
 */
function collectionView(col, { rarity = 'all', show = 'all' } = {}, dr = null) {
  const cards = (col?.cards ?? []).filter((c) => (rarity === 'all' || c.rarity === rarity) && (show === 'all' || (show === 'owned' ? c.owned : !c.owned)));
  const seg = (action, value, options) => `<div class="tabs">${options.map(([v, label]) => `<button class="tab ${value === v ? 'active' : ''}" data-action="${action}" data-id="${v}">${label}</button>`).join('')}</div>`;
  return `<div class="dr-collection">
    ${
      dr
        ? `<aside class="dr-col-side">
        ${rarityTable(dr, { won: true, filter: rarity })}
        <div class="dr-dupe-line">${dupeRing(dr.duplicateChance)}<span><b>${fmtChance(dr.duplicateChance)} chance of a duplicate</b><small>On the next claim, by Kick’s odds</small></span></div>
        <div class="dr-luck">${luckLine(dr.stats)}</div>
        <p class="dr-col-note">Kick only gives odds by rarity, so every card of a rarity counts as equally likely. Won and Dupes count the claims Pear Drops saw.</p>
      </aside>`
        : ''
    }
    <div class="dr-col-main">
      <div class="dr-col-bar"><b>${rarity === 'all' ? 'Every card' : `${rarityName(rarity)} cards`}</b><span class="muted">${cards.length}</span>${rarity === 'all' ? '' : `<button class="btn sm ghost" data-action="col-rarity" data-id="all">${icon('x')} Every rarity</button>`}<span class="spacer"></span>${seg('col-show', show, [['all', 'All'], ['owned', 'Owned'], ['missing', 'Missing']])}</div>
      <div class="dr-col-grid">${cards
        .map((c) => {
          const won = col.wins?.[c.id] ?? 0;
          return `<div class="dr-col-card r-${esc(c.rarity)} ${c.owned ? 'owned' : 'missing'}" data-tip="${esc(`${cardName(c)} · ${rarityName(c.rarity)} ${c.type ?? 'emote'}${c.owned ? '' : '\nNot in your collection yet'}${won ? `\nWon ${won === 1 ? 'once' : `${won} times`}` : ''}`)}">${img(c.image)}${won > 1 ? `<span class="dr-won-count">×${won}</span>` : ''}</div>`;
        })
        .join('')}</div>
    </div>
  </div>`;
}
