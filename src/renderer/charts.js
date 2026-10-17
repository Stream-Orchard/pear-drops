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

/**
 * Progress over time for one campaign: credited history, a forecast band and
 * projection, and each upcoming reward marked (with its picture) where it unlocks.
 */
function progressChart({ points, rewards, target, now, rate = 1, width = 720, height = 260, forecast: showForecast = true, idPrefix = 'pc' }) {
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

  const t0 = Math.min(pts[0][0], now - 45 * CHART_MIN);
  const futureSpan = Number.isFinite(doneMin) && remaining > 0 ? Math.min(doneMin, 12 * 60) * 1.1 : 30;
  const t1 = showForecast ? now + Math.max(20, futureSpan) * CHART_MIN : now + (now - t0) * 0.02;
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
    if (tHit > t1) return;
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
    const text = final ? `Done ${clockLabel(tHit)} · ${durLabel((tHit - now) / CHART_MIN)}` : `${rw.name} · ${clockLabel(tHit)}`;
    labels.push(pill(xx, ly, text, { cls: final ? 'p-final' : 'p-next', ...bounds }));
  });

  return `<svg class="chart progress-chart" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
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
    <text x="${xNow + 12}" y="${pad.t - 1}" class="region">FORECAST</text>` : ''}
    <text x="${pad.l + 4}" y="${pad.t - 1}" class="region">CREDITED</text>
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
 * events the player sent (dots), with stream switches and claims.
 */
function heartbeatStrip(timeline, now, { minutes = 60, width = 600, height = 78 } = {}) {
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
  }
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${parts.join('')}</svg>`;
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
