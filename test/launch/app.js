// Starts the real app in demo mode (stand-in Kick, made-up data) with its own
// temporary data folder, for launch tests, screenshots and the trailer.
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function playwright() {
  try {
    return require('playwright');
  } catch {
    throw new Error('Playwright is not installed: run `npm run test:setup` first.');
  }
}

/**
 * options: signedIn (skip the welcome screen), seed (believable history),
 * eventSeconds (stand-in player's watch event interval), hidden, settings.
 */
async function launchApp({ signedIn = true, seed = true, eventSeconds = 120, hidden = !process.env.KDF_TEST_VISIBLE, mirror = false, settings, files = {}, env: extraEnv = {}, scale, size = { width: 1480, height: 940 } } = {}) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'kdf-test-'));
  if (settings) fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify(settings));
  // Other files to start with in the data folder, e.g. { 'updates.json': {...} }.
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(data, name), typeof content === 'string' ? content : JSON.stringify(content));
  const env = {
    ...process.env,
    KDF_DEMO: '1',
    KDF_DEV_DATA: data,
    KDF_DEMO_EVENT_SECONDS: String(eventSeconds),
    ...(size ? { KDF_NO_MAXIMIZE: '1' } : {}),
    ...(signedIn ? { KDF_DEMO_SIGNED_IN: '1' } : {}),
    ...(seed ? { KDF_DEMO_SEED: '1' } : {}),
    ...(hidden ? { KDF_TEST_HIDDEN: '1' } : {}),
    ...(mirror ? { KDF_MIRROR_PLAYER: '1' } : {}),
    ...(scale ? { KDF_SCALE: String(scale) } : {}),
    ...extraEnv,
  };
  const app = await playwright()._electron.launch({ args: [ROOT], cwd: ROOT, env });
  const errors = [];
  const win = await app.firstWindow();
  win.on('pageerror', (err) => errors.push(String(err)));
  await win.waitForLoadState('domcontentloaded');
  if (size) {
    const got = await app.evaluate(({ BrowserWindow, screen }, s) => {
      const w = BrowserWindow.getAllWindows().find((x) => /index\.html$/.test(x.webContents.getURL()));
      if (!w) return null;
      // Allow sizes bigger than this screen (to check large monitors).
      w.setMinimumSize(800, 600);
      w.setBounds({ x: 0, y: 0, width: s.width, height: s.height }, false);
      return [w.getBounds(), screen.getPrimaryDisplay().workAreaSize];
    }, size);
    await win.waitForTimeout(400);
    if (process.env.KDF_DEBUG_SIZE) console.log('window', got);
  }
  return {
    app,
    win,
    errors,
    data,
    /** Runs fn(kdfDemo) in the main process. */
    demo: (fn, arg) => app.evaluate(new Function('electron', 'arg', `return (${fn.toString()})(global.kdfDemo, arg)`), arg),
    async close() {
      await app.close().catch(() => {});
      fs.rmSync(data, { recursive: true, force: true });
    },
  };
}

/** Waits until fn(page) is truthy (polling), or fails with `what`. */
async function until(page, fn, what, timeout = 15000, arg) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await page.evaluate(fn, arg).catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await page.waitForTimeout(150);
  }
}

module.exports = { launchApp, until, ROOT };
