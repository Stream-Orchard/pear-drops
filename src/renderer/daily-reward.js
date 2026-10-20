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
  [2.2, 20.6, 'g'], [4.4, 22.3, 't'], [7.6, 23.2, 'g'], [11, 23.6, 't'], [14.4, 23.4, 'g'], [17.8, 22.9, 't'],
  [20.6, 21.6, 'g'], [21.4, 19.6, 't'], [1.6, 18.8, 't'], [19.2, 18.4, 'g'],
];
function chestMark(cls = '') {
  return `<svg class="icon chest ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <g class="chest-burst" stroke="none">${BURST.map(([x, y, c]) => `<rect class="${c}" x="${x - 0.7}" y="${y - 0.7}" width="1.4" height="1.4"/>`).join('')}</g>
    <g class="chest-box"><path class="chest-body" d="M3.5 9 5.5 5h13l2 4v10a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z"/><path d="M3.5 10h17M8.5 5v15"/>
      <path class="chest-latch" d="M12.6 10v2.8l2.65 2.1 2.65-2.1V10"/></g>
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

/** What a card is, in words: "Rare emote". Kick gives no names; the name is on the card's picture. */
const cardKind = (c) => `${rarityName(c?.rarity)} ${c?.type === 'badge' ? 'badge' : 'emote'}`;

/** What a claimed card was: new, or a duplicate turned into level progress. */
function winnerLine(t, { short = false } = {}) {
  if (!t?.winner) return '';
  const kind = `<b>${cardKind(t.winner)}</b>`;
  if (!t.duplicate) return `${kind}<span class="chip green new">New</span>`;
  if (short) return `${kind}<span class="chip">Duplicate</span>`;
  const xp = t.xpMinutes ? `<span class="dr-xp">+${fmtDur(t.xpMinutes * MIN)}</span> watch time${t.levelTo ? ` to Level ${t.levelTo}` : ''}` : 'Turned into level progress';
  return `<span class="dr-dupe">You already have this ${kind}</span><span class="dr-sub">${xp}</span>`;
}

// ------------------------------------------------------------------ the chest button

/** What the chest's tooltip says. */
function chestTip(dr) {
  if (dr.state === 'ready') return `Daily reward is ready. Claim before ${fmtClock(dr.endsAt)}${dr.claimMode === 'before-reset' ? '\nPear Drops claims it 15 minutes before, if you haven’t' : ''}`;
  if (dr.state === 'earning') return `Daily reward · ${dr.minutes} of ${dr.threshold} min\n${dr.threshold - dr.minutes} min to go${dr.watching ? '' : ' (not watching)'}`;
  if (dr.state === 'claimed' && dr.today?.winner) return `Today: a ${cardKind(dr.today.winner).toLowerCase()}${dr.today.duplicate ? ' (a duplicate)' : ''}\nNext one in ${fmtDur(dr.endsAt - Date.now())}`;
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
function rarityTable(dr) {
  const by = dr.collection?.byRarity ?? {};
  const odds = Object.fromEntries((dr.odds ?? []).map((o) => [o.rarity, o.chance]));
  return `<div class="dr-rarities">
    <div class="dr-rarity head"><span>Rarity</span><span>Chance</span><span class="own">Yours</span></div>
    ${RARITIES.map(([id, name]) => {
      const c = by[id] ?? { owned: 0, total: 0 };
      return `<div class="dr-rarity r-${id}"><span class="name"><i></i>${name}</span><span class="pct">${odds[id] == null ? '—' : fmtChance(odds[id])}</span>
        <span class="own"><span class="bar"><i style="width:${c.total ? (c.owned / c.total) * 100 : 0}%"></i></span><span class="count"><b>${c.owned}</b>/${c.total}</span></span></div>`;
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
    // Claimed on kick.com (or before Pear Drops was running): Kick may not say what it was.
    stage = t.winner
      ? `<div class="dr-stage won r-${esc(t.winner.rarity)}"><div class="dr-won-glow"></div>${img(t.winner.image, 'dr-won-card', cardKind(t.winner))}</div>
      <div class="dr-result">${winnerLine(t)}</div>`
      : `<div class="dr-stage">${crateArt('dim')}<div class="dr-stage-msg">${icon('check')}Claimed today, outside Pear Drops.</div></div>`;
    middle = `${factsRow(dr)}${rarityTable(dr)}
      <div class="dr-dupe-line">${dupeRing(dr.duplicateChance)}<span><b>${fmtChance(dr.duplicateChance)} chance of a duplicate</b><small>Tomorrow, with ${dr.collection?.owned ?? 0} of Kick’s ${dr.collection?.total ?? 0} cards yours</small></span></div>`;
    actions = `<div class="dr-actions">${t.replay ? `<button class="btn" data-action="reward-replay">${icon('play')} Replay</button>` : ''}<button class="btn" data-action="reward-collection" data-tip="Every card, and which are yours, on kick.com">${icon('external')} Collection</button></div>`;
  } else {
    const ready = dr.state === 'ready';
    // While it's ready, the opening video loads in the background, so the reveal starts at once.
    const preload = ready && dr.media?.unbox ? `<video class="dr-preload" src="${esc(dr.media.unbox)}" preload="auto" muted hidden></video>` : '';
    stage = `<div class="dr-stage ${ready ? 'ready' : 'earning'}">${crateStage(dr)}${ready ? '<span class="chip green dr-ready">Ready</span>' : ''}${preload}</div>
      ${ready ? '' : `<div class="dr-progress"><span class="label">Watched today</span><span class="bar"><i style="width:${(dr.minutes / Math.max(1, dr.threshold)) * 100}%"></i></span><span><b>${dr.minutes}</b> of ${dr.threshold} min</span></div>`}`;
    middle = `${factsRow(dr)}${rarityTable(dr)}
      <div class="dr-dupe-line">${dupeRing(dr.duplicateChance)}<span><b>${fmtChance(dr.duplicateChance)} chance of a duplicate</b><small>You have ${dr.collection?.owned ?? 0} of Kick’s ${dr.collection?.total ?? 0} cards</small></span></div>`;
    const label = dr.claiming ? 'Claiming…' : ready ? 'Claim' : dr.watching ? `Claim in ${left} min` : `Watch ${left} more min`;
    actions = `<div class="dr-actions"><button class="btn primary lg dr-claim" data-action="reward-claim" ${ready && !dr.claiming ? '' : 'disabled'}>${label}</button></div>`;
  }
  // Other crates: an event's, or Kick's one-time Welcome Reward (unlocked by its sign-up questions).
  const extras = (dr.extras ?? []).map((e) => {
    const what = e.state === 'ready' ? 'Ready to open' : e.condition === 'onboarding_completed' ? 'Answer Kick’s sign-up questions to unlock it' : `${e.minutes} of ${e.threshold} min watched`;
    const act =
      e.state === 'ready'
        ? `<button class="btn sm primary" data-action="reward-claim" data-id="${esc(e.id)}">Claim</button>`
        : e.condition === 'onboarding_completed'
          ? `<button class="btn sm icon-only" data-action="reward-kick" data-tip="Open Kick">${icon('external')}</button>`
          : '';
    return `<div class="dr-extra">${chestMark()}<span><b>${esc(e.name || 'Reward')}</b><small>${what}</small></span>${act}</div>`;
  });
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
    <div class="dr-winner r-${esc(w.rarity ?? 'common')}"><div class="dr-won-glow"></div>${img(w.image, 'dr-won-card', cardKind(w))}
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
