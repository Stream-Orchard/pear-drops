// Menu bar / system tray: an icon that draws the current drop's progress as a ring (the logo
// while no stream is live for the drops left, the hopping chest while the daily reward waits),
// and a popover with the live state and quick controls.
const { Tray, BrowserWindow, nativeImage, screen, ipcMain, systemPreferences } = require('electron');
const path = require('path');

const COLORS = {
  farming: [83, 252, 24],
  paused: [251, 191, 75],
  waiting: [251, 191, 75],
  conflict: [255, 93, 110],
  error: [255, 93, 110],
  done: [255, 211, 106],
  idle: [150, 156, 166],
};

// The popover's size is kept here, not read back from the window: Windows with display scaling
// reports a frameless, fixed-size window a little bigger than it was set, so resizing from what it
// reports grows it on every update.
const WIDTH = 360;
const HEIGHT = 520;

/** A progress ring as BGRA pixels (no canvas in the main process). */
function ringPixels(fraction, tone, { size = 18, scale = 2 } = {}) {
  const px = size * scale;
  const buf = Buffer.alloc(px * px * 4);
  const c = px / 2;
  const radius = px * 0.36;
  const thick = px * 0.13;
  const [r, g, b] = COLORS[tone] ?? COLORS.idle;
  const f = Math.max(0, Math.min(1, fraction));
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const d = Math.hypot(dx, dy);
      // ring coverage, anti-aliased over one pixel
      const ring = Math.max(0, Math.min(1, thick / 2 + 0.5 - Math.abs(d - radius)));
      // centre dot
      const dot = Math.max(0, Math.min(1, px * 0.12 + 0.5 - d));
      let angle = Math.atan2(dx, -dy);
      if (angle < 0) angle += Math.PI * 2;
      const done = angle / (Math.PI * 2) <= f;
      let R = 0,
        G = 0,
        B = 0,
        A = 0;
      if (ring > 0) {
        if (done) [R, G, B, A] = [r, g, b, 255 * ring];
        else [R, G, B, A] = [140, 146, 156, 120 * ring];
      }
      if (dot > 0) {
        const a = 255 * dot;
        [R, G, B, A] = [r, g, b, Math.max(A, a)];
      }
      const i = (y * px + x) * 4;
      // BGRA, premultiplied
      const k = A / 255;
      buf[i] = B * k;
      buf[i + 1] = G * k;
      buf[i + 2] = R * k;
      buf[i + 3] = A;
    }
  }
  return { buf, px };
}

// ------------------------------------------------------------------ shapes from SVG paths
// The logo and the chest are the pages' own SVG paths, drawn here into pixels: each path is cut
// into straight lines, then filled (nonzero, 4×4 samples a pixel) or stroked (round ends and
// joins, edges smoothed over one pixel).

/** An SVG path's outlines as lists of points: M L H V C A Z, absolute or relative. */
function pathOutlines(d) {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/g);
  const outlines = [];
  let line = null;
  let [x, y, sx, sy] = [0, 0, 0, 0];
  let cmd = '';
  let i = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const [ox, oy] = rel ? [x, y] : [0, 0];
    switch (cmd.toUpperCase()) {
      case 'M':
        [x, y] = [ox + num(), oy + num()];
        [sx, sy] = [x, y];
        line = { points: [[x, y]], closed: false };
        outlines.push(line);
        cmd = rel ? 'l' : 'L'; // more pairs after a move are lines
        break;
      case 'L':
        [x, y] = [ox + num(), oy + num()];
        line.points.push([x, y]);
        break;
      case 'H':
        x = ox + num();
        line.points.push([x, y]);
        break;
      case 'V':
        y = oy + num();
        line.points.push([x, y]);
        break;
      case 'C': {
        const [x1, y1, x2, y2, x3, y3] = [ox + num(), oy + num(), ox + num(), oy + num(), ox + num(), oy + num()];
        for (let k = 1; k <= 16; k++) {
          const t = k / 16;
          const u = 1 - t;
          line.points.push([u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3]);
        }
        [x, y] = [x3, y3];
        break;
      }
      case 'A': {
        const [rx, ry, rot, large, sweep] = [num(), num(), num(), num(), num()];
        const [ex, ey] = [ox + num(), oy + num()];
        line.points.push(...arcPoints(x, y, rx, ry, rot, !!large, !!sweep, ex, ey));
        [x, y] = [ex, ey];
        break;
      }
      case 'Z':
        line.closed = true;
        [x, y] = [sx, sy];
        break;
      default:
        throw new Error(`Unsupported path command ${cmd}`);
    }
  }
  return outlines;
}

/** An SVG arc, from its end points to its centre (SVG 1.1, F.6.5), cut into short lines. */
function arcPoints(x1, y1, rx, ry, rotDeg, large, sweep, x2, y2) {
  const phi = (rotDeg * Math.PI) / 180;
  const [cos, sin] = [Math.cos(phi), Math.sin(phi)];
  const [dx, dy] = [(x1 - x2) / 2, (y1 - y2) / 2];
  const [xp, yp] = [cos * dx + sin * dy, -sin * dx + cos * dy];
  const grow = Math.sqrt(Math.max(1, (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry)));
  [rx, ry] = [Math.abs(rx) * grow, Math.abs(ry) * grow];
  const den = rx * rx * yp * yp + ry * ry * xp * xp;
  const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, (rx * rx * ry * ry - den) / den));
  const [cxp, cyp] = [(co * rx * yp) / ry, (-co * ry * xp) / rx];
  const [cx, cy] = [cos * cxp - sin * cyp + (x1 + x2) / 2, sin * cxp + cos * cyp + (y1 + y2) / 2];
  const angle = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const start = angle(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let turn = angle((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!sweep && turn > 0) turn -= Math.PI * 2;
  if (sweep && turn < 0) turn += Math.PI * 2;
  const steps = Math.max(2, Math.ceil(Math.abs(turn) / (Math.PI / 16)));
  const points = [];
  for (let k = 1; k <= steps; k++) {
    const t = start + (turn * k) / steps;
    points.push([cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos]);
  }
  return points;
}

/** Square pixels to paint on, premultiplied RGBA from 0 to 1. */
class Pixels {
  constructor(px) {
    this.px = px;
    this.rgba = new Float32Array(px * px * 4);
  }

  /** Paints [r, g, b] (0-255) over pixel i with coverage a (0-1). */
  paint(i, [r, g, b], a) {
    const p = this.rgba;
    const o = i * 4;
    const keep = 1 - a;
    p[o] = (r / 255) * a + p[o] * keep;
    p[o + 1] = (g / 255) * a + p[o + 1] * keep;
    p[o + 2] = (b / 255) * a + p[o + 2] * keep;
    p[o + 3] = a + p[o + 3] * keep;
  }

  /** The outlines' edges in pixels, through `map` (a viewBox point to a pixel point). */
  static edges(outlines, map) {
    const edges = [];
    for (const { points, closed } of outlines) {
      const pts = points.map(map);
      for (let k = 1; k < pts.length; k++) edges.push([pts[k - 1], pts[k]]);
      if (closed && pts.length > 1) edges.push([pts[pts.length - 1], pts[0]]);
    }
    return edges;
  }

  /** The pixels the edges can touch, grown by `pad`, inside the image. */
  bounds(edges, pad) {
    const xs = edges.flatMap(([a, b]) => [a[0], b[0]]);
    const ys = edges.flatMap(([a, b]) => [a[1], b[1]]);
    const clamp = (v) => Math.max(0, Math.min(this.px, v));
    return [clamp(Math.floor(Math.min(...xs) - pad)), clamp(Math.ceil(Math.max(...xs) + pad)), clamp(Math.floor(Math.min(...ys) - pad)), clamp(Math.ceil(Math.max(...ys) + pad))];
  }

  fill(outlines, map, color, opacity = 1) {
    const edges = Pixels.edges(outlines, map);
    if (!edges.length) return;
    const [x0, x1, y0, y1] = this.bounds(edges, 1);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        let inside = 0;
        for (let sy = 0; sy < 4; sy++) {
          for (let sx = 0; sx < 4; sx++) {
            const [px, py] = [x + (sx + 0.5) / 4, y + (sy + 0.5) / 4];
            let wind = 0;
            for (const [[ax, ay], [bx, by]] of edges) {
              if (ay <= py ? by > py && (bx - ax) * (py - ay) - (px - ax) * (by - ay) > 0 : by <= py && (bx - ax) * (py - ay) - (px - ax) * (by - ay) < 0) wind += ay <= py ? 1 : -1;
            }
            if (wind) inside++;
          }
        }
        if (inside) this.paint(y * this.px + x, color, (inside / 16) * opacity);
      }
    }
  }

  stroke(outlines, map, width, color, opacity = 1) {
    const edges = Pixels.edges(outlines, map);
    if (!edges.length) return;
    const half = width / 2;
    const [x0, x1, y0, y1] = this.bounds(edges, half + 1);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const [px, py] = [x + 0.5, y + 0.5];
        let near = Infinity;
        for (const [[ax, ay], [bx, by]] of edges) {
          const [ex, ey] = [bx - ax, by - ay];
          const t = Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey || 1)));
          near = Math.min(near, Math.hypot(px - ax - t * ex, py - ay - t * ey));
        }
        const a = Math.max(0, Math.min(1, half + 0.5 - near));
        if (a > 0) this.paint(y * this.px + x, color, a * opacity);
      }
    }
  }

  /** BGRA, premultiplied, as nativeImage.createFromBitmap takes it. */
  toBGRA() {
    const buf = Buffer.alloc(this.px * this.px * 4);
    for (let i = 0; i < this.px * this.px; i++) {
      const o = i * 4;
      buf[o] = Math.round(this.rgba[o + 2] * 255);
      buf[o + 1] = Math.round(this.rgba[o + 1] * 255);
      buf[o + 2] = Math.round(this.rgba[o] * 255);
      buf[o + 3] = Math.round(this.rgba[o + 3] * 255);
    }
    return buf;
  }
}

// The logo: brandMark() in src/renderer/icons.js (a 32-unit viewBox), with no tile behind it.
const LOGO = {
  drop: 'M16 1.25C19.68 5.99 26.54 12.94 26.54 20.21a10.54 10.54 0 0 1-21.08 0C5.46 12.94 12.32 5.99 16 1.25Z',
  shine: 'M9.46 16.94c-1.06 1.63-1.55 3.35-1.47 5.07',
  // The pear, in its own 1024-unit box: translate(16 20.45) scale(0.02043) translate(-512 -520).
  pear: 'M512 252C447 252 413.2 306.6 413.2 371.6C413.2 426.2 382 457.4 343 504.2C298.8 556.2 267.6 608.2 267.6 670.6C267.6 795.4 374.2 870.8 512 870.8C649.8 870.8 756.4 795.4 756.4 670.6C756.4 608.2 725.2 556.2 681 504.2C642 457.4 610.8 426.2 610.8 371.6C610.8 306.6 577 252 512 252Z',
  stem: 'M512 262.4C512 220.8 525 184.4 548.4 158.4',
  leaf: 'M553.6 200C579.6 140.2 652.4 122 709.6 140.2C691.4 200 623.8 231.2 553.6 200Z',
};

/** The logo as BGRA pixels: shown while no stream is live for the drops left. */
function logoPixels({ size = 18, scale = 2 } = {}) {
  const px = size * scale;
  const k = px / 32;
  const canvas = new Pixels(px);
  const map = ([x, y]) => [x * k, y * k];
  const pear = 0.02043;
  const mapPear = ([x, y]) => map([16 + (x - 512) * pear, 20.45 + (y - 520) * pear]);
  canvas.fill(pathOutlines(LOGO.drop), map, [83, 252, 24]);
  canvas.stroke(pathOutlines(LOGO.shine), map, 1.23 * k, [255, 255, 255], 0.5);
  canvas.fill(pathOutlines(LOGO.pear), mapPear, [10, 20, 6]);
  canvas.stroke(pathOutlines(LOGO.stem), mapPear, 46 * pear * k, [10, 20, 6]);
  canvas.fill(pathOutlines(LOGO.leaf), mapPear, [10, 20, 6]);
  return { buf: canvas.toBGRA(), px };
}

// The chest: chestMark() in src/renderer/daily-reward.js (a 24-unit viewBox), hopping as
// dr-hop and dr-burst in daily-reward.css do, from the bottom of the chest (12, 19.5).
const CHEST = {
  body: 'M3.5 8.5 5.5 4.5h13l2 4v10a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z',
  lines: ['M3.5 9.5h17M8.5 4.5v15', 'M12.6 9.5v2.8l2.65 2.1 2.65-2.1V9.5'],
  burst: [
    [2.2, 20.1, 'g'], [4.4, 21.8, 't'], [7.6, 22.7, 'g'], [11, 23.1, 't'], [14.4, 22.9, 'g'], [17.8, 22.4, 't'],
    [20.6, 21.1, 'g'], [21.4, 19.1, 't'], [1.6, 18.3, 't'], [19.2, 17.9, 'g'],
  ],
};
// [at, translateY, scaleX, scaleY, rotate°], from dr-hop. Each step eases linearly to the next.
const HOP = [
  [0, 0, 1, 1, 0], [0.16, 0, 1.04, 0.77, 0], [0.194, -0.9, 1.02, 0.86, 0], [0.226, -3.6, 0.98, 1.08, 0],
  [0.258, -5, 0.97, 1.15, 0], [0.29, -5.4, 0.97, 1.18, 0], [0.323, -5.9, 1, 1.08, -2.5], [0.387, -6.1, 1, 1.05, 3],
  [0.452, -6.2, 1, 1, -1], [0.484, -6, 1, 1, -2.5], [0.516, -6.4, 1, 1, 0], [0.548, -6.2, 1, 1, 3],
  [0.58, -6.1, 1, 1.12, 3], [0.613, -5.9, 0.97, 1.23, 1.5], [0.645, -4.4, 1, 0.95, 0.5], [0.677, 0, 1.06, 0.82, 0],
  [0.71, 0, 1.03, 0.92, 0], [0.774, 0, 0.99, 1.04, 0], [0.87, 0, 1.01, 0.99, 0], [1, 0, 1, 1, 0],
];
// [at, opacity, scale], from dr-burst.
const BURST = [[0, 0, 0.5], [0.68, 0, 0.5], [0.71, 1, 0.75], [0.82, 1, 1.05], [0.97, 0, 1.3], [1, 0, 1.3]];
const HOP_MS = 1292;
const HOP_FRAMES = 20;
// The page lets the chest leap out of its box; an icon has a fixed one, so the tray's chest
// leaps half as high, inside a view a little bigger than the chest's own.
const CHEST_VIEW = { x: -1.5, y: -2.5, size: 27 };
const LEAP = 0.5;

/** dr-hop or dr-burst at `t` (0-1 of the loop): each value eased linearly between its steps. */
function keyframe(steps, t) {
  const k = steps.findIndex((s) => s[0] > t);
  if (k <= 0) return steps[steps.length - 1].slice(1);
  const [a, b] = [steps[k - 1], steps[k]];
  const f = (t - a[0]) / (b[0] - a[0]);
  return a.slice(1).map((v, j) => v + (b[j + 1] - v) * f);
}

/** The chest at `t` (0-1 of its hop) as BGRA pixels: shown while the daily reward waits. */
function chestPixels(t = 0, { size = 18, scale = 2 } = {}) {
  const px = size * scale;
  const k = px / CHEST_VIEW.size;
  const canvas = new Pixels(px);
  const view = ([x, y]) => [(x - CHEST_VIEW.x) * k, (y - CHEST_VIEW.y) * k];
  const [ox, oy] = [12, 19.5];
  const [ty, sx, sy, deg] = keyframe(HOP, t);
  const [cos, sin] = [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
  // translateY, then scale, then rotate, about the chest's bottom.
  const hop = ([x, y]) => {
    const [rx, ry] = [(x - ox) * cos - (y - oy) * sin, (x - ox) * sin + (y - oy) * cos];
    return view([ox + rx * sx, oy + ry * sy + ty * LEAP]);
  };
  const width = 2 * k * Math.sqrt(sx * sy);
  const [opacity, grow] = keyframe(BURST, t);
  if (opacity > 0) {
    const colours = { g: [83, 252, 24], t: [46, 230, 197] };
    for (const [x, y, c] of CHEST.burst) {
      const r = 0.7;
      const at = ([bx, by]) => view([ox + (bx - ox) * grow, oy + (by - oy) * grow]);
      canvas.fill([{ points: [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]], closed: true }], at, colours[c], opacity);
    }
  }
  const body = pathOutlines(CHEST.body);
  canvas.fill(body, hop, [83, 252, 24], 0.14);
  canvas.stroke(body, hop, width, [83, 252, 24]);
  for (const d of CHEST.lines) canvas.stroke(pathOutlines(d), hop, width, [83, 252, 24]);
  return { buf: canvas.toBGRA(), px };
}

function toImage({ buf, px }, scale = 2) {
  return nativeImage.createFromBitmap(buf, { width: px, height: px, scaleFactor: scale });
}

/** Whether the system asks for less motion (the chest then sits still). */
function reducedMotion() {
  return !!systemPreferences.getAnimationSettings?.().prefersReducedMotion;
}

class TrayController {
  /** ipc: where its page's messages are handled (main.js passes one that only answers the popover). */
  /** image and motion: how pixels become an icon, and whether the chest may hop (tests pass their own). */
  constructor({ preload, onShowMain, onQuit, onAction, ipc = ipcMain, screen: display = screen, image = toImage, motion = () => !reducedMotion() }) {
    this.preload = preload;
    this.screen = display;
    this.image = image;
    this.motion = motion;
    this.icons = {};
    this.hop = null;
    this.onShowMain = onShowMain;
    this.onQuit = onQuit;
    this.tray = null;
    this.popover = null;
    this.iconKey = '';
    this.hiddenAt = 0;
    this.height = HEIGHT;

    ipc.handle('tray:show-main', () => {
      this.hidePopover();
      this.onShowMain();
    });
    ipc.handle('tray:quit', () => this.onQuit());
    ipc.handle('tray:resize', (_e, height) => Number.isFinite(height) && this.resize(height));
    ipc.handle('tray:action', (_e, name) => ['pause', 'resume', 'skip', 'refresh'].includes(name) && onAction(name));
  }

  create() {
    if (this.tray) return;
    this.tray = new Tray(this.image(ringPixels(0, 'idle')));
    this.tray.setToolTip('Pear Drops');
    this.tray.on('click', () => this.toggle());
    this.tray.on('right-click', () => this.toggle());
  }

  /** info: { tone, fraction, title, tooltip, mark }; mark: 'chest' or 'logo' in place of the ring. */
  update(info, { showPercent = true } = {}) {
    if (!this.tray) return;
    const key = info.mark ?? `${info.tone}:${Math.round(info.fraction * 100)}`;
    if (key !== this.iconKey) {
      this.iconKey = key;
      this.stopHop();
      if (info.mark === 'chest') this.startHop();
      else if (info.mark === 'logo') this.tray.setImage((this.icons.logo ??= this.image(logoPixels())));
      else this.tray.setImage(this.image(ringPixels(info.fraction, info.tone)));
    }
    if (process.platform === 'darwin') this.tray.setTitle(showPercent && info.title ? ` ${info.title}` : '', { fontType: 'monospacedDigit' });
    this.tray.setToolTip(info.tooltip);
  }

  /** The chest's frames are drawn once; it loops through them while the reward waits. */
  startHop() {
    const frames = (this.icons.chest ??= Array.from({ length: HOP_FRAMES }, (_, i) => this.image(chestPixels(i / HOP_FRAMES))));
    this.tray.setImage(frames[0]);
    if (!this.motion()) return;
    let i = 0;
    this.hop = setInterval(() => {
      i = (i + 1) % frames.length;
      this.tray?.setImage(frames[i]);
    }, HOP_MS / frames.length);
  }

  stopHop() {
    clearInterval(this.hop);
    this.hop = null;
  }

  ensurePopover() {
    if (this.popover && !this.popover.isDestroyed()) return this.popover;
    const mac = process.platform === 'darwin';
    this.height = HEIGHT;
    this.popover = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      transparent: mac,
      vibrancy: mac ? 'popover' : undefined,
      visualEffectState: mac ? 'active' : undefined,
      backgroundColor: mac ? '#00000000' : '#101215',
      roundedCorners: true,
      webPreferences: { preload: this.preload, contextIsolation: true, sandbox: true },
    });
    this.popover.loadFile(path.join(__dirname, '..', 'renderer', 'tray.html'));
    this.popover.on('blur', () => this.hidePopover());
    return this.popover;
  }

  get window() {
    return this.popover && !this.popover.isDestroyed() ? this.popover : null;
  }

  toggle() {
    // A click on the icon blurs (and hides) the popover first: don't reopen it.
    if (Date.now() - this.hiddenAt < 250) return;
    const win = this.ensurePopover();
    if (win.isVisible()) return this.hidePopover();
    this.position();
    if (process.env.PD_TEST_HIDDEN) {
      // Invisible in tests; nearly, on Linux, which stops drawing fully transparent windows.
      win.setOpacity(process.platform === 'linux' ? 0.01 : 0);
      win.showInactive();
      return;
    }
    win.show();
    win.focus();
  }

  hidePopover() {
    if (this.window?.isVisible()) {
      this.window.hide();
      this.hiddenAt = Date.now();
    }
  }

  position() {
    const win = this.window;
    if (!win || !this.tray) return;
    const t = this.tray.getBounds();
    const [w, h] = [WIDTH, this.height];
    const display = this.screen.getDisplayNearestPoint({ x: t.x, y: t.y });
    const area = display.workArea;
    let x = Math.round(t.x + t.width / 2 - w / 2);
    // Menu bar at the top (macOS) vs taskbar at the bottom (Windows, most Linux).
    let y = t.y < area.y + area.height / 2 ? Math.round(t.y + t.height + 6) : Math.round(t.y - h - 6);
    x = Math.max(area.x + 8, Math.min(x, area.x + area.width - w - 8));
    y = Math.max(area.y + 4, Math.min(y, area.y + area.height - h - 4));
    win.setBounds({ x, y, width: w, height: h }, false);
  }

  resize(height) {
    const win = this.window;
    if (!win) return;
    const h = Math.max(200, Math.min(720, Math.round(height)));
    if (h === this.height) return;
    this.height = h;
    if (win.isVisible()) this.position();
    else win.setSize(WIDTH, h, false);
  }

  destroy() {
    this.stopHop();
    this.tray?.destroy();
    this.tray = null;
    if (this.window) this.popover.destroy();
  }
}

module.exports = { TrayController, ringPixels, logoPixels, chestPixels, pathOutlines, HOP_FRAMES, HOP_MS, WIDTH };
