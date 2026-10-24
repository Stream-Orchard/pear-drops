// Formatting and DOM helpers shared by the dashboard and the tray popover.
/* global escapeHtml */
const MIN = 60_000;
const $ = (sel, el = document) => el.querySelector(sel);

const esc = escapeHtml;

function fmtDur(ms) {
  if (!Number.isFinite(ms)) return '—';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
const fmtMin = (minutes) => (Number.isFinite(minutes) ? fmtDur(minutes * MIN) : '—');
const fmtClock = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// When a time is, in the computer's locale: "2:36 AM" today, "Tue 2:36 AM" in the next six days,
// "Sat, Oct 31" after that (or before today), with the year when it isn't this one.
// A weekday a week away would read as today, so that gets a date. Stream Multiview says it the same way.
function fmtWhen(t) {
  const d = new Date(t);
  const now = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const days = Math.round((day(d) - day(now)) / 86_400_000);
  const time = { hour: 'numeric', minute: '2-digit' };
  if (days === 0) return d.toLocaleTimeString([], time);
  if (days > 0 && days < 7) return d.toLocaleString([], { weekday: 'short', ...time });
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() && { year: 'numeric' }) });
}

function fmtAgo(t) {
  if (!t) return 'never';
  const d = Date.now() - t;
  if (d < 15_000) return 'just now';
  return `${fmtDur(d)} ago`;
}

/**
 * How the stream being watched is doing, for the player chips on the dashboard and tray:
 * { state, label, tone: good | warn | bad, foot }, or null when nothing is watched.
 */
function streamHealth(f) {
  const h = f?.health;
  if (!f?.current || !h) return null;
  const v = f.player?.video;
  const look = {
    playing: ['Playing', 'good', `${v?.height ? `${v.height}p · ` : ''}window muted`],
    loading: ['Loading', 'warn', 'starting the player'],
    buffering: ['Buffering', 'warn', 'waiting for video'],
    paused: ['Paused', 'bad', 'will resume itself'],
    frozen: ['Frozen', 'bad', h.text],
    checking: ['Checking', 'warn', h.text],
  }[h.state] ?? ['Loading', 'warn', h.text ?? ''];
  return { state: h.state, label: look[0], tone: look[1], foot: look[2] };
}

/** What just happened to the stream (it ended, a raid, a reload), with where the app went next. */
function streamNotice(f) {
  const n = f?.notice;
  if (!n) return null;
  const moved = f.current && n.slug && f.current.slug !== n.slug;
  const next = moved ? `, now watching ${f.current.username}` : !f.current && !f.paused ? ', looking for another stream' : '';
  const icon = { ended: 'power', raid: 'skip', reload: 'reload', switch: 'skip' }[n.kind] ?? 'alert';
  return { kind: n.kind, icon, text: `${n.text}${next}`, at: n.at };
}

function fmtCount(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n ?? 0);
}

function fmtEnds(iso) {
  const d = new Date(iso).getTime() - Date.now();
  if (d <= 0) return 'ended';
  if (d < 3600_000) return `ends in ${Math.ceil(d / MIN)}m`;
  if (d < 2 * 86_400_000) return `ends in ${Math.round(d / 3600_000)}h`;
  return `ends in ${Math.round(d / 86_400_000)}d`;
}

function fmtEta(minutes) {
  if (!Number.isFinite(minutes) || minutes > 60 * 24 * 30) return '—';
  if (minutes <= 0) return 'now';
  return `${fmtMin(minutes)} · ${fmtFinish(minutes)}`;
}

// When something `minutes` from now happens, on its own ("Sun 2:40 AM"), for a row of its own
// where "22h 46m · Sun 2:40 AM" would wrap.
function fmtFinish(minutes) {
  if (!Number.isFinite(minutes) || minutes > 60 * 24 * 30) return '—';
  if (minutes <= 0) return 'now';
  return fmtWhen(Date.now() + minutes * MIN);
}

// Charts are drawn at the card's real width so their text isn't stretched.
function widthOf(el, fallback) {
  const w = Math.round(el?.clientWidth || 0);
  return w > 100 ? w : fallback;
}

// Patches the element's DOM to match `html` instead of replacing it, so images,
// hover, focus and scroll positions stay put and nothing flickers or jumps.
function setHTML(el, html) {
  if (!el || el.__html === html) return;
  el.__html = html;
  if (!el.firstChild) {
    el.innerHTML = html;
    return;
  }
  const next = document.createElement('template');
  next.innerHTML = html;
  morphChildren(el, next.content);
}

function morphChildren(from, to) {
  const a = [...from.childNodes];
  const b = [...to.childNodes];
  for (let i = 0; i < b.length; i++) {
    const cur = a[i];
    const want = b[i];
    if (!cur) from.appendChild(want);
    else if (!sameKind(cur, want)) from.replaceChild(want, cur);
    else morphNode(cur, want);
  }
  for (let i = b.length; i < a.length; i++) a[i].remove();
}

function sameKind(x, y) {
  return x.nodeType === y.nodeType && x.nodeName === y.nodeName && (x.nodeType !== 1 || (x.getAttribute('data-key') ?? '') === (y.getAttribute('data-key') ?? ''));
}

function morphNode(cur, want) {
  if (cur.nodeType !== 1) {
    if (cur.nodeValue !== want.nodeValue) cur.nodeValue = want.nodeValue;
    return;
  }
  for (const { name, value } of [...want.attributes]) if (cur.getAttribute(name) !== value) cur.setAttribute(name, value);
  for (const { name } of [...cur.attributes]) if (!want.hasAttribute(name)) cur.removeAttribute(name);
  // Don't fight the user while they type.
  if ((cur.tagName === 'INPUT' || cur.tagName === 'TEXTAREA') && cur !== document.activeElement && cur.value !== (want.getAttribute('value') ?? '')) cur.value = want.getAttribute('value') ?? '';
  morphChildren(cur, want);
}

// Images that didn't load (Kick's thumbnail for a stream that just started, an expired link),
// and when: shown as a placeholder for a few minutes, then tried again.
const brokenImages = new Map();
const BROKEN_RETRY_MS = 5 * 60_000;
const isBroken = (src) => {
  const at = brokenImages.get(src);
  if (at && Date.now() - at > BROKEN_RETRY_MS) brokenImages.delete(src);
  return brokenImages.has(src);
};

/** An image's placeholder: its box, with a faint picture in it, while there's nothing to show. */
const imgPlaceholder = (cls = '', alt = '') => `<span class="${cls ? `${cls} img-missing` : 'img-missing fill'}" role="img" aria-label="${esc(alt)}"></span>`;

const img = (src, cls = '', alt = '') =>
  src && !isBroken(src) ? `<img class="${cls}" src="${esc(src)}" alt="${esc(alt)}" decoding="async" referrerpolicy="no-referrer" />` : imgPlaceholder(cls, alt);

// One that fails gives way to its placeholder at once, rather than the broken-image icon.
document.addEventListener(
  'error',
  (event) => {
    const el = event.target;
    if (el?.tagName !== 'IMG' || !el.getAttribute('src') || el.closest?.('svg')) return;
    brokenImages.set(el.getAttribute('src'), Date.now());
    const t = document.createElement('template');
    t.innerHTML = imgPlaceholder(el.getAttribute('class') ?? '', el.getAttribute('alt') ?? '');
    el.replaceWith(t.content.firstChild);
  },
  true,
);

// Focus rings are for the keyboard: a click (or the docked stream handing focus back) never
// leaves one on a button. Tab and the arrow keys bring them back.
document.documentElement.dataset.input = 'pointer';
document.addEventListener('pointerdown', () => (document.documentElement.dataset.input = 'pointer'), true);
document.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Tab' || e.key.startsWith('Arrow')) document.documentElement.dataset.input = 'keys';
  },
  true,
);

// The app's font (settings.font, see styles.css): the system's own (SF Pro, Segoe UI), or the
// bundled Inter, which measures the same everywhere. Linux uses Inter unless told otherwise.
function applyFont(choice) {
  const font = choice === 'system' || choice === 'bundled' ? choice : navigator.platform.startsWith('Linux') ? 'bundled' : 'system';
  if (document.documentElement.dataset.font !== font) document.documentElement.dataset.font = font;
}
applyFont();

// ------------------------------------------------------------------ tooltips
/**
 * The right-hand limit for a pop-up spanning top..bottom: the docked stream is a
 * separate view laid over the page, and nothing the page draws can show above it.
 */
function popupWall(top, bottom) {
  const slot = document.getElementById('player-slot');
  const r = slot?.getBoundingClientRect();
  if (!r || r.width < 10 || r.height < 10 || bottom < r.top || top > r.bottom) return innerWidth;
  return r.left;
}

// The app's own tooltips for anything with data-tip (native ones are slow and
// unreliable, especially in the tray popover): a short delay, kept on screen.
(() => {
  let tip = null;
  let timer = null;
  let target = null;
  const hide = () => {
    clearTimeout(timer);
    target = null;
    tip?.classList.remove('on');
  };
  const show = (el) => {
    const text = el.getAttribute('data-tip');
    if (!text || !document.body.contains(el)) return;
    tip ??= Object.assign(document.createElement('div'), { className: 'tooltip' });
    if (!tip.isConnected) document.body.appendChild(tip);
    tip.textContent = text;
    tip.classList.add('on');
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const below = r.top - t.height - 8 < 4;
    const top = below ? r.bottom + 8 : r.top - t.height - 8;
    const wall = popupWall(top, top + t.height);
    const left = Math.max(6, Math.min(wall - t.width - 6, r.left + r.width / 2 - t.width / 2));
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  };
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest?.('[data-tip]');
    if (el === target) return;
    hide();
    if (!el) return;
    target = el;
    timer = setTimeout(() => show(el), 380);
  });
  document.addEventListener('mousedown', hide, true);
  document.addEventListener('scroll', hide, true);
  // Hidden once the pointer leaves the window. (Not on blur: the docked stream takes
  // focus whenever it loads a channel, while the pointer is still here.)
  document.documentElement.addEventListener('mouseleave', hide);
})();

// ------------------------------------------------------------------ reward previews
// Hovering any reward thumbnail shows it large: the real emote when it's in your
// emote list (animated if it is), otherwise the reward's full-size artwork.
const KIND_LABEL = { emote: 'Emote', badge: 'Badge', kick: 'Kick reward', game: 'Game drop' };

/** Attributes that give an element a reward preview on hover. */
function previewAttrs(r, units, ended = false) {
  const status = r.claimed ? 'Claimed' : ended ? `Missed · ${Math.min(units ?? 0, r.required)}/${r.required} min` : r.ready ? 'Ready to claim' : units !== undefined ? `${Math.min(units, r.required)}/${r.required} min` : `${r.required} min`;
  const real = r.preview?.url;
  return [
    'data-preview',
    `data-img="${esc(real ?? r.image ?? '')}"`,
    `data-name="${esc(r.name)}"`,
    `data-kind="${esc(KIND_LABEL[r.kind] ?? 'Reward')}"`,
    `data-status="${esc(status)}"`,
    real ? `data-real="${esc(r.preview.name)}"` : '',
    r.preview?.animated ? 'data-animated' : '',
    r.claimed ? 'data-claimed' : '',
  ].join(' ');
}

(() => {
  let card = null;
  let timer = null;
  let target = null;
  const hide = () => {
    clearTimeout(timer);
    target = null;
    card?.classList.remove('on');
  };
  const show = (el) => {
    if (!document.body.contains(el)) return;
    card ??= Object.assign(document.createElement('div'), { className: 'reward-preview' });
    if (!card.isConnected) document.body.appendChild(card);
    const d = el.dataset;
    card.innerHTML = `<div class="rp-art">${d.img ? `<img src="${esc(d.img)}" alt="" referrerpolicy="no-referrer" />` : ''}</div>
      <div class="rp-body"><b>${esc(d.name)}</b>
        <div class="rp-tags"><span class="chip">${esc(d.kind)}</span>${'animated' in d ? '<span class="chip green">Animated</span>' : ''}<span class="chip ${'claimed' in d ? 'green' : ''}">${esc(d.status)}</span></div>
        ${d.real ? `<div class="rp-note">Your emote <code>${esc(d.real)}</code></div>` : '<div class="rp-note">Reward artwork from the drop</div>'}</div>`;
    card.classList.add('on');
    const r = el.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    const top = Math.max(8, Math.min(innerHeight - c.height - 8, r.top + r.height / 2 - c.height / 2));
    // Beside the reward, on whichever side has room before the edge or the stream.
    const wall = popupWall(top, top + c.height);
    const right = r.right + 12 + c.width < wall - 8;
    const left = right ? r.right + 12 : Math.max(8, Math.min(wall - 8 - c.width, r.left - 12 - c.width));
    card.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  };
  let pointer = null;
  document.addEventListener('mouseover', (e) => {
    pointer = [e.clientX, e.clientY];
    const el = e.target.closest?.('[data-preview]');
    if (el === target) return;
    hide();
    if (!el) return;
    target = el;
    timer = setTimeout(() => show(el), 250);
  });
  document.addEventListener('mousedown', hide, true);
  // A scroll hides it only if the reward slid out from under the pointer.
  document.addEventListener(
    'scroll',
    () => {
      const under = pointer && document.elementFromPoint(...pointer)?.closest?.('[data-preview]');
      if (!target || under !== target) hide();
      else if (card?.classList.contains('on')) show(target);
    },
    true,
  );
  // Hidden once the pointer leaves the window. (Not on blur: the docked stream takes
  // focus whenever it loads a channel, while the pointer is still here.)
  document.documentElement.addEventListener('mouseleave', hide);
})();

// ------------------------------------------------------------------ queue rows

/** Channel names as a row says them: "SolarFlair", "Driftwood & SolarFlair", "NightOwl, LofiLane +1". */
function channelNames(chs, { or = false } = {}) {
  const n = chs.map((c) => c.username || c.slug);
  if (n.length <= 1) return n[0] ?? '';
  if (or) return `${n.slice(0, -1).join(', ')} or ${n.at(-1)}`;
  if (n.length === 2) return `${n[0]} & ${n[1]}`;
  return `${n[0]}, ${n[1]} +${n.length - 2}`;
}

/**
 * A queue row's picture: a category's art; for a drop limited to certain channels, its channel's
 * avatar with the category's art as a badge, or two avatars overlapping and "+N" for the rest.
 */
function rowArt(cat, cls = 'cat-art') {
  if (cat.kind === 'category' || !cat.channels?.length) return img(cat.image, cls, cat.name);
  const chs = cat.channels;
  const av = (ch) => img(ch.avatar, 'av', ch.username);
  if (chs.length === 1) return `<span class="row-art one ${cls}-row" data-tip="${esc(chs[0].username)} · ${esc(cat.category?.name ?? '')}">${av(chs[0])}${img(cat.category?.image, 'cat-badge')}</span>`;
  return `<span class="row-art many ${cls}-row" data-tip="${esc(chs.map((c) => c.username).join(', '))} · ${esc(cat.category?.name ?? '')}">${chs.slice(0, 2).map(av).join('')}${chs.length > 2 ? `<span class="more">+${chs.length - 2}</span>` : ''}</span>`;
}
