// Menu bar / system tray: an icon that draws the current drop's progress as a ring,
// and a popover with the live state and quick controls.
const { Tray, BrowserWindow, nativeImage, screen, ipcMain } = require('electron');
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

/** A progress ring as BGRA pixels (no canvas in the main process), with a green dot at its top right when `badge`. */
function ringPixels(fraction, tone, { size = 18, scale = 2, badge = false } = {}) {
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
      if (badge) {
        // The daily reward waits: a green dot over the ring's top right, with a clear edge round it.
        const bd = Math.hypot(x + 0.5 - px * 0.82, y + 0.5 - px * 0.18);
        const edge = Math.max(0, Math.min(1, px * 0.2 + 0.5 - bd));
        const fill = Math.max(0, Math.min(1, px * 0.14 + 0.5 - bd));
        if (edge > 0) [R, G, B, A] = [R, G, B, A * (1 - edge)];
        if (fill > 0) [R, G, B, A] = [83, 252, 24, Math.max(A, 255 * fill)];
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

function ringIcon(fraction, tone, { size = 18, scale = 2, badge = false } = {}) {
  const { buf, px } = ringPixels(fraction, tone, { size, scale, badge });
  return nativeImage.createFromBitmap(buf, { width: px, height: px, scaleFactor: scale });
}

class TrayController {
  /** ipc: where its page's messages are handled (main.js passes one that only answers the popover). */
  constructor({ preload, onShowMain, onQuit, onAction, ipc = ipcMain, screen: display = screen }) {
    this.preload = preload;
    this.screen = display;
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
    this.tray = new Tray(ringIcon(0, 'idle'));
    this.tray.setToolTip('Pear Drops');
    this.tray.on('click', () => this.toggle());
    this.tray.on('right-click', () => this.toggle());
  }

  /** info: { tone, fraction, title, tooltip, badge } */
  update(info, { showPercent = true } = {}) {
    if (!this.tray) return;
    const key = `${info.tone}:${Math.round(info.fraction * 100)}:${info.badge ? 1 : 0}`;
    if (key !== this.iconKey) {
      this.iconKey = key;
      this.tray.setImage(ringIcon(info.fraction, info.tone, { badge: !!info.badge }));
    }
    if (process.platform === 'darwin') this.tray.setTitle(showPercent && info.title ? ` ${info.title}` : '', { fontType: 'monospacedDigit' });
    this.tray.setToolTip(info.tooltip);
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
    this.tray?.destroy();
    this.tray = null;
    if (this.window) this.popover.destroy();
  }
}

module.exports = { TrayController, ringIcon, ringPixels, WIDTH };
