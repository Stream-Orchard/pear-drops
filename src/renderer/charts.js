// SVG chart builders. Each returns an SVG string drawn at its real pixel size.
/* global escapeHtml */
const CHART_MIN = 60_000;

function clockLabel(t) {
  return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function durLabel(minutes) {
  if (!Number.isFinite(minutes)) return '—';
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))}m`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)}h ${String(Math.round(minutes % 60)).padStart(2, '0')}m`;
  return `${Math.round(minutes / 1440)}d`;
}

/** Circular progress ring. */
function progressRing(fraction, { size = 132, stroke = 10, label = '', sub = '' } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, fraction || 0));
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <defs>
      <linearGradient id="ring-g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#8cff5c"/><stop offset="1" stop-color="#22c55e"/>
      </linearGradient>
    </defs>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="rgba(255,255,255,.07)" stroke-width="${stroke}" fill="none"/>
    <circle class="ring-value" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="url(#ring-g)" stroke-width="${stroke}" fill="none"
      stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - f)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    <text x="50%" y="47%" text-anchor="middle" class="ring-label">${label}</text>
    <text x="50%" y="64%" text-anchor="middle" class="ring-sub">${sub}</text>
  </svg>`;
}

// A rounded "pill" label, kept inside [minX, maxX].
function pill(x, y, text, { cls = '', anchor = 'middle', minX = 0, maxX = 1e9 } = {}) {
  const w = Math.round(text.length * 6.3 + 20);
  const h = 22;
  let left = anchor === 'end' ? x - w : anchor === 'start' ? x : x - w / 2;
  left = Math.max(minX, Math.min(left, maxX - w));
  return `<g class="pill ${cls}">
    <rect x="${left}" y="${y - h / 2}" width="${w}" height="${h}" rx="${h / 2}"/>
    <text x="${left + w / 2}" y="${y + 4}" text-anchor="middle">${escapeHtml(text)}</text></g>`;
}

// The longest forecast the progress chart draws (two weeks), in minutes.
const MAX_FORECAST_MIN = 14 * 1440;

/**
 * Progress over time for one campaign: credited history, a forecast band and
 * projection, and each upcoming reward marked (with its picture) where it unlocks.
 */
function progressChart({ points, rewards, target, now, rate = 1, width = 720, height = 260, forecast: showForecast = true, resume = false, idPrefix = 'pc' }) {
  // Stable ids: an unchanged chart produces identical markup and isn't touched.
  const id = idPrefix;
  const pad = { l: 42, r: 18, t: 34, b: 26 };
  const w = Math.max(200, width - pad.l - pad.r);
  const h = Math.max(80, height - pad.t - pad.b);
  const pts = points.length ? points : [[now, 0]];
  const units = pts[pts.length - 1][1];
  const r = rate > 0.02 ? rate : 0;
  const remaining = Math.max(0, (target || 0) - units);
  const doneMin = r ? remaining / r : Infinity;

  // The forecast runs all the way to the campaign being done (up to two weeks), and the past
  // keeps at least a sixth of the width so the "now" label and the region names fit beside it.
  const futureSpan = Number.isFinite(doneMin) && remaining > 0 ? Math.min(doneMin, MAX_FORECAST_MIN) * 1.1 : 30;
  const future = Math.max(20, futureSpan) * CHART_MIN;
  const t0 = Math.min(pts[0][0], now - 45 * CHART_MIN, showForecast ? now - future * 0.2 : Infinity);
  const t1 = showForecast ? now + future : now + (now - t0) * 0.02;
  const yTop = Math.max(target || 0, units) * 1.08 || 10;
  const yMin = Math.max(0, Math.min(...pts.map((p) => p[1])) - yTop * 0.08);
  const x = (t) => pad.l + ((t - t0) / (t1 - t0)) * w;
  const y = (u) => pad.t + h - ((u - yMin) / (yTop - yMin || 1)) * h;
  const xNow = x(now);
  const yNow = y(units);
  const bottom = pad.t + h;
  const bounds = { minX: pad.l, maxX: pad.l + w };

  // ---- grid
  const grid = [];
  const span = t1 - t0;
  const multiDay = span > 30 * 60 * CHART_MIN;
  if (multiDay) {
    // Midnights, labelled with the date.
    const dayMs = 1440 * CHART_MIN;
    const every = Math.max(1, Math.ceil(span / dayMs / Math.max(1, Math.floor(w / 70))));
    const d = new Date(t0);
    d.setHours(24, 0, 0, 0);
    for (let t = d.getTime(), i = 0; t <= t1; t += dayMs, i++) {
      if (i % every) continue;
      const xx = x(t);
      grid.push(`<line x1="${xx}" x2="${xx}" y1="${pad.t}" y2="${bottom}" class="grid"/><text x="${xx}" y="${height - 6}" text-anchor="middle" class="axis">${new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' })}</text>`);
    }
  } else {
    const step = [10, 15, 30, 60, 120, 180, 240, 360].map((m) => m * CHART_MIN).find((s) => span / s <= 7) ?? 720 * CHART_MIN;
    for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) {
      const xx = x(t);
      grid.push(`<line x1="${xx}" x2="${xx}" y1="${pad.t}" y2="${bottom}" class="grid"/><text x="${xx}" y="${height - 6}" text-anchor="middle" class="axis">${clockLabel(t)}</text>`);
    }
  }
  const niceStep = [5, 10, 15, 30, 60, 120, 300, 600].find((s) => (yTop - yMin) / s <= 4) ?? 1200;
  for (let u = Math.ceil(yMin / niceStep) * niceStep; u <= yTop; u += niceStep) {
    grid.push(`<line x1="${pad.l}" x2="${pad.l + w}" y1="${y(u)}" y2="${y(u)}" class="grid"/><text x="${pad.l - 10}" y="${y(u) + 4}" text-anchor="end" class="axis">${u}</text>`);
  }

  // ---- history
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ') + ` L${xNow.toFixed(1)},${yNow.toFixed(1)}`;
  const area = `${line} L${xNow.toFixed(1)},${bottom} L${x(pts[0][0]).toFixed(1)},${bottom} Z`;

  // ---- forecast band (faster / slower than now) and projection
  let forecast = '';
  if (showForecast && r && remaining > 0) {
    const tEnd = Math.min(t1, now + doneMin * CHART_MIN);
    const uAt = (t, k) => Math.min(target, units + ((t - now) / CHART_MIN) * r * k);
    const steps = 16;
    const hi = [];
    const lo = [];
    for (let i = 0; i <= steps; i++) {
      const t = now + ((tEnd - now) * i) / steps;
      hi.push(`${x(t).toFixed(1)},${y(uAt(t, 1.15)).toFixed(1)}`);
      lo.unshift(`${x(t).toFixed(1)},${y(uAt(t, 0.85)).toFixed(1)}`);
    }
    forecast = `<polygon points="${[...hi, ...lo].join(' ')}" fill="url(#${id}-band)"/>
      <path d="M${xNow},${yNow} L${x(tEnd)},${y(uAt(tEnd, 1))}" class="projection" stroke="url(#${id}-proj)"/>`;
  }

  const uAt = (t) => Math.min(target, units + ((t - now) / CHART_MIN) * r);

  // ---- rewards: reached ones on the history line, upcoming ones on the projection
  const markers = [];
  const labels = [];
  const tracked = (rewards || []).filter((rw) => rw.tracked).sort((a, b) => a.required - b.required);
  const last = tracked[tracked.length - 1];
  let prevLabel = null;
  tracked.forEach((rw) => {
    const yy = y(rw.required);
    if (rw.required <= units) {
      const hit = pts.find((p) => p[1] >= rw.required);
      if (!hit || hit[0] <= t0) return;
      const xx = x(hit[0]);
      markers.push(`<circle cx="${xx}" cy="${yy}" r="6" class="m-past"/><path d="M${xx - 2.6},${yy} l1.8,1.9 l3.4,-3.6" class="m-check"/>`);
      return;
    }
    if (!r || !showForecast) return;
    const tHit = now + ((rw.required - units) / r) * CHART_MIN;
    if (tHit > t1) {
      // Done further out than the chart reaches: say when, at its edge.
      const text = resume ? `Done ${durLabel((tHit - now) / CHART_MIN)} after resuming` : `Done in ${durLabel((tHit - now) / CHART_MIN)}`;
      if (rw === last) labels.push(pill(pad.l + w, y(uAt(t1)) - 22, text, { cls: 'p-final', anchor: 'end', ...bounds }));
      return;
    }
    const xx = x(tHit);
    const clip = `${id}-c${markers.length}`;
    const final = rw === last;
    markers.push(`<line x1="${xNow}" x2="${xx}" y1="${yy}" y2="${yy}" class="guide"/>
      <clipPath id="${clip}"><circle cx="${xx}" cy="${yy}" r="10"/></clipPath>
      <circle cx="${xx}" cy="${yy}" r="13.5" class="m-ring ${final ? 'final' : ''}"/>
      ${rw.image ? `<image href="${escapeHtml(rw.image)}" x="${xx - 10}" y="${yy - 10}" width="20" height="20" clip-path="url(#${clip})" preserveAspectRatio="xMidYMid slice"/>` : ''}`);
    // Labels sit above their marker; one that would collide drops below instead.
    let ly = yy - 27;
    if (prevLabel && Math.abs(prevLabel.x - xx) < 150 && Math.abs(prevLabel.y - ly) < 24) ly = yy + 27;
    prevLabel = { x: xx, y: ly };
    // Paused, there's no telling when: say how long after resuming instead.
    const after = durLabel((tHit - now) / CHART_MIN);
    const text = resume ? (final ? `Done ${after} after resuming` : `${rw.name} · ${after} in`) : final ? `Done ${clockLabel(tHit)} · ${after}` : `${rw.name} · ${clockLabel(tHit)}`;
    labels.push(pill(xx, ly, text, { cls: final ? 'p-final' : 'p-next', ...bounds }));
  });

  return `<svg class="chart progress-chart${resume ? ' resume' : ''}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
    <defs>
      <linearGradient id="${id}-area" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#53fc18" stop-opacity=".30"/><stop offset="1" stop-color="#53fc18" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="${id}-future" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#2ee6c5" stop-opacity=".07"/><stop offset="1" stop-color="#2ee6c5" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="${id}-band" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#53fc18" stop-opacity=".20"/><stop offset="1" stop-color="#2ee6c5" stop-opacity=".06"/>
      </linearGradient>
      <linearGradient id="${id}-proj" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#53fc18"/><stop offset="1" stop-color="#2ee6c5"/>
      </linearGradient>
    </defs>
    ${showForecast ? `<rect x="${xNow}" y="${pad.t - 14}" width="${Math.max(0, pad.l + w - xNow)}" height="${h + 14}" rx="10" fill="url(#${id}-future)"/>
    <text x="${xNow + 12}" y="${pad.t - 1}" class="region">${resume ? 'IF YOU RESUME' : 'FORECAST'}</text>` : ''}
    ${xNow - pad.l > 90 ? `<text x="${pad.l + 4}" y="${pad.t - 1}" class="region">CREDITED</text>` : ''}
    ${grid.join('')}
    <path d="${area}" fill="url(#${id}-area)"/>
    ${forecast}
    <path d="${line}" class="series-glow"/>
    <path d="${line}" class="series"/>
    <line x1="${xNow}" x2="${xNow}" y1="${pad.t - 14}" y2="${bottom}" class="now-line"/>
    ${markers.join('')}
    <circle cx="${xNow}" cy="${yNow}" r="10" class="now-halo"/>
    <circle cx="${xNow}" cy="${yNow}" r="5" class="now-dot"/>
    ${pill(xNow - 14, showForecast ? yNow + 4 : yNow - 22, `${units} min now`, { cls: 'p-now', anchor: 'end', ...bounds })}
    ${labels.join('')}
  </svg>`;
}

/**
 * Last `minutes` of activity in two lanes: credits Kick gave (bars) and watch
 * events the player sent (dots), with stream switches and claims. With nothing
 * playing (`idle` is what to say), each check with Kick is a ring on the events
 * lane, the newest pulsing, and a glow runs along the empty lanes.
 */
function heartbeatStrip(timeline, now, { minutes = 60, width = 600, height = 78, idle = '' } = {}) {
  const t0 = now - minutes * CHART_MIN;
  const pad = { l: 62, r: 10 };
  const w = Math.max(100, width - pad.l - pad.r);
  const x = (t) => pad.l + ((t - t0) / (now - t0)) * w;
  const creditBase = 38;
  const eventY = 52;
  const parts = [
    `<text x="0" y="${creditBase - 4}" class="lane">CREDITS</text><text x="0" y="${eventY + 4}" class="lane">EVENTS</text>`,
    `<line x1="${pad.l}" x2="${pad.l + w}" y1="${creditBase}" y2="${creditBase}" class="baseline"/>`,
    `<line x1="${pad.l}" x2="${pad.l + w}" y1="${eventY}" y2="${eventY}" class="baseline faint"/>`,
  ];
  for (let m = 0; m <= minutes; m += 15) {
    const t = t0 + m * CHART_MIN;
    parts.push(`<text x="${x(t)}" y="${height - 3}" text-anchor="${m === 0 ? 'start' : m === minutes ? 'end' : 'middle'}" class="axis">${m === minutes ? 'now' : `−${minutes - m}m`}</text>`);
  }
  for (const e of timeline) {
    if (e.t < t0) continue;
    const xx = x(e.t).toFixed(1);
    if (e.type === 'sent') parts.push(`<circle cx="${xx}" cy="${eventY}" r="2.6" class="hb-sent"/>`);
    else if (e.type === 'credit') {
      const hgt = Math.min(30, 8 + e.delta * 5);
      parts.push(`<rect x="${xx - 2.5}" y="${creditBase - hgt}" width="5" height="${hgt}" rx="2.5" class="hb-credit"/>`);
    } else if (e.type === 'switch') parts.push(`<line x1="${xx}" x2="${xx}" y1="6" y2="${eventY + 6}" class="hb-switch"/><circle cx="${xx}" cy="6" r="3" class="hb-switch-dot"/>`);
    else if (e.type === 'claim') parts.push(`<circle cx="${xx}" cy="8" r="5" class="hb-claim"/>`);
    else if (e.type === 'check') parts.push(`<circle cx="${xx}" cy="${eventY}" r="3.2" class="hb-check${e.ok === false ? ' bad' : ''}"/>`);
  }
  const last = timeline.findLast((e) => e.type === 'check' && e.t >= t0);
  if (last && now - last.t < 10_000) {
    // Keyed by the check, so each new one pulses once and a redraw doesn't start it again.
    const xx = x(last.t).toFixed(1);
    parts.push(`<circle data-key="hb-ping-${last.t}" cx="${xx}" cy="${eventY}" r="14" class="hb-ping${last.ok === false ? ' bad' : ''}" style="transform-origin:${xx}px ${eventY}px"/>`);
  }
  // What it's showing, while there's nothing else in the lanes to read.
  const busy = timeline.some((e) => e.t >= t0 && (e.type === 'sent' || e.type === 'credit'));
  if (idle) {
    const lanes = 'hb-lanes';
    const mx = pad.l + w * 0.6;
    const bw = Math.round(idle.length * 5.7 + 26);
    parts.push(
      `<defs><linearGradient id="hb-glow-fill" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2ee6c5" stop-opacity="0"/><stop offset=".8" stop-color="#2ee6c5" stop-opacity=".7"/><stop offset="1" stop-color="#fff" stop-opacity=".95"/></linearGradient>
        <clipPath id="${lanes}"><rect x="${pad.l}" y="0" width="${w}" height="${height}"/></clipPath></defs>
      <g clip-path="url(#${lanes})">${[creditBase, eventY]
        .map((yy, i) => `<rect x="${pad.l - 120}" y="${yy - 1}" width="120" height="2" rx="1" fill="url(#hb-glow-fill)" class="hb-glow${i ? ' late' : ''}" style="--run:${w + 120}px"/>`)
        .join('')}</g>
      ${busy ? '' : `<g class="hb-idle"><rect x="${(mx - bw / 2).toFixed(1)}" y="${eventY - 29}" width="${bw}" height="20" rx="10"/><text x="${mx.toFixed(1)}" y="${eventY - 15}" text-anchor="middle">${escapeHtml(idle)}</text></g>`}`,
    );
  }
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${parts.join('')}</svg>`;
}

/**
 * What the progress chart shows while nothing is playing, under a dome:
 * - 'scan': a radar beam sweeps over the categories still to go (`items`), each lighting up
 *   with its name as the beam passes. `tone: 'warn'` while Kick isn't answering.
 * - 'paused': the same categories, still and dimmed.
 * - 'done': the rewards collected (`items`), in an arc, with a shimmer running along them.
 * Each check with Kick (`checkedAt`) sends a ripple out from the centre. All of it is CSS
 * animation, so the system's reduce-motion setting stills it, and a redraw with the same
 * things to show leaves the markup, and so the animation, alone.
 */
function idleScene({ mode, items = [], width = 720, height = 260, checkedAt = null, tone = '', now = Date.now(), idPrefix = 'is' }) {
  const id = idPrefix;
  const cx = width / 2;
  const cy = height - 20;
  const R = Math.max(60, Math.min(width / 2 - 34, height - 44));
  const cls = tone === 'warn' ? 'warn' : mode;
  const arc = (r) => `M${(cx - r).toFixed(1)},${cy} A${r.toFixed(1)},${r.toFixed(1)} 0 0 1 ${(cx + r).toFixed(1)},${cy}`;
  const origin = `transform-origin:${cx.toFixed(1)}px ${cy}px`;
  const parts = [];

  // The dome: a glow, rings and spokes.
  parts.push(`<path d="${arc(R)} Z" fill="url(#${id}-dome)"/>`);
  for (const k of [0.25, 0.5, 0.75, 1]) parts.push(`<path d="${arc(R * k)}" class="is-ring${k === 1 ? ' edge' : ''}"/>`);
  for (const a of [30, 60, 90, 120, 150]) {
    const r = (a * Math.PI) / 180;
    parts.push(`<line x1="${cx.toFixed(1)}" y1="${cy}" x2="${(cx - Math.cos(r) * R).toFixed(1)}" y2="${(cy - Math.sin(r) * R).toFixed(1)}" class="is-spoke"/>`);
  }
  parts.push(`<line x1="${(cx - R - 14).toFixed(1)}" x2="${(cx + R + 14).toFixed(1)}" y1="${cy}" y2="${cy}" class="is-base"/>`);

  const inside = [];
  const SWEEP_S = 6; // one pass of the beam, left to right (keep in step with idle-sweep in styles.css)
  if (mode === 'scan') {
    // A wedge trailing the beam, fading out behind it.
    const wedge = [];
    for (let i = 0; i < 12; i++) {
      const a0 = ((-60 + i * 5) * Math.PI) / 180;
      const a1 = ((-55 + i * 5) * Math.PI) / 180;
      const r = R * 1.1;
      wedge.push(
        `<path d="M${cx.toFixed(1)},${cy} L${(cx + Math.cos(a0) * r).toFixed(1)},${(cy + Math.sin(a0) * r).toFixed(1)} A${r.toFixed(1)},${r.toFixed(1)} 0 0 1 ${(cx + Math.cos(a1) * r).toFixed(1)},${(cy + Math.sin(a1) * r).toFixed(1)} Z" opacity="${(0.008 + i * i * 0.0014).toFixed(3)}"/>`,
      );
    }
    inside.push(`<g class="is-beam" style="${origin}">${wedge.join('')}<line x1="${cx.toFixed(1)}" y1="${cy}" x2="${(cx + R * 1.1).toFixed(1)}" y2="${cy}"/></g>`);
  }
  if (checkedAt && now - checkedAt < 10_000) {
    // Keyed by the check: each new one ripples once.
    inside.push(
      `<g data-key="is-ripple-${checkedAt}">${[0, 1].map((k) => `<circle cx="${cx.toFixed(1)}" cy="${cy}" r="${R.toFixed(1)}" class="is-ripple${k ? ' late' : ''}" style="${origin}"/>`).join('')}</g>`,
    );
  }

  const marks = [];
  const defs = [];
  if (mode === 'done') {
    const list = items.slice(0, 12);
    const ar = R * 0.74;
    list.forEach((it, i) => {
      const a = (Math.PI * (i + 0.5)) / list.length;
      const x = cx - Math.cos(a) * ar;
      const y = cy - Math.sin(a) * ar;
      defs.push(`<clipPath id="${id}-c${i}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="13"/></clipPath>`);
      marks.push(`<g class="is-reward"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="16.5" class="is-disc"/>
        ${it.image ? `<image href="${escapeHtml(it.image)}" x="${(x - 13).toFixed(1)}" y="${(y - 13).toFixed(1)}" width="26" height="26" clip-path="url(#${id}-c${i})" preserveAspectRatio="xMidYMid slice"><title>${escapeHtml(it.name)}</title></image>` : ''}
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="16.5" class="is-shine" style="animation-delay:${((i / list.length) * 2.4).toFixed(2)}s"/></g>`);
    });
    // A trophy at the centre.
    marks.push(`<g class="is-trophy" transform="translate(${(cx - 12).toFixed(1)},${cy - 34})"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></g>`);
  } else {
    // Spread over the dome, alternating near and far so neighbours' names don't collide.
    const list = items.slice(0, 8);
    const near = [0.72, 0.46, 0.86, 0.6];
    list.forEach((it, i) => {
      const deg = (180 * (i + 0.5)) / list.length;
      const a = (deg * Math.PI) / 180;
      const k = near[i % near.length];
      const x = cx - Math.cos(a) * R * k;
      const y = cy - Math.sin(a) * R * k;
      // The beam passes this angle `deg / 180` of the way through its sweep.
      const delay = `animation-delay:${((deg / 180) * SWEEP_S).toFixed(2)}s`;
      defs.push(`<clipPath id="${id}-c${i}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="13"/></clipPath>`);
      marks.push(`<g class="is-blip">
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="17" class="is-halo" style="${delay}"/>
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="14.5" class="is-disc"/>
        ${it.image ? `<image href="${escapeHtml(it.image)}" x="${(x - 13).toFixed(1)}" y="${(y - 13).toFixed(1)}" width="26" height="26" clip-path="url(#${id}-c${i})" preserveAspectRatio="xMidYMid slice" class="is-art" style="${delay}"/>` : ''}
        <text x="${x.toFixed(1)}" y="${(y + 30).toFixed(1)}" text-anchor="middle" class="is-name" style="${delay}">${escapeHtml(it.name)}</text></g>`);
    });
    if (mode === 'scan') marks.push(`<circle cx="${cx.toFixed(1)}" cy="${cy}" r="12" class="is-core-halo" style="${origin}"/><circle cx="${cx.toFixed(1)}" cy="${cy}" r="4" class="is-core"/>`);
    else marks.push(`<g class="is-chip"><rect x="${(cx - 56).toFixed(1)}" y="${cy - 44}" width="112" height="28" rx="14"/><text x="${cx.toFixed(1)}" y="${cy - 26}" text-anchor="middle">Paused</text></g>`);
  }

  return `<svg class="chart idle-scene is-${cls}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
    <defs>
      <radialGradient id="${id}-dome" cx=".5" cy="1" r="1"><stop offset="0" class="is-stop" stop-opacity=".13"/><stop offset=".75" class="is-stop" stop-opacity=".025"/><stop offset="1" class="is-stop" stop-opacity="0"/></radialGradient>
      <clipPath id="${id}-in"><path d="${arc(R)} Z"/></clipPath>
      ${defs.join('')}
    </defs>
    ${parts.join('')}
    <g clip-path="url(#${id}-in)">${inside.join('')}</g>
    ${marks.join('')}
  </svg>`;
}

/** Tiny bar sparkline. */
function sparkBars(values, { width = 120, height = 34, max } = {}) {
  if (!values.length) return '';
  const top = max ?? Math.max(1, ...values);
  const bw = width / values.length;
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${values
    .map((v, i) => {
      const hgt = Math.max(2, (v / top) * (height - 2));
      return `<rect x="${(i * bw + 1).toFixed(1)}" y="${(height - hgt).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${hgt.toFixed(1)}" rx="1.5" class="${v ? 'spark-on' : 'spark-off'}"/>`;
    })
    .join('')}</svg>`;
}
