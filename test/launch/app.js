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
async function launchApp({ signedIn = true, seed = true, eventSeconds = 120, hidden = !process.env.PD_TEST_VISIBLE, mirror = false, settings, files = {}, env: extraEnv = {}, scale, size = { width: 1480, height: 940 } } = {}) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-test-'));
  if (settings) fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify(settings));
  // Other files to start with in the data folder, e.g. { 'updates.json': {...} }.
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(data, name), typeof content === 'string' ? content : JSON.stringify(content));
  const env = {
    ...process.env,
    PD_DEMO: '1',
    PD_DEV_DATA: data,
    PD_DEMO_EVENT_SECONDS: String(eventSeconds),
    ...(size ? { PD_NO_MAXIMIZE: '1' } : {}),
    ...(signedIn ? { PD_DEMO_SIGNED_IN: '1' } : {}),
    ...(seed ? { PD_DEMO_SEED: '1' } : {}),
    ...(hidden ? { PD_TEST_HIDDEN: '1' } : {}),
    ...(mirror ? { PD_MIRROR_PLAYER: '1' } : {}),
    ...(scale ? { PD_SCALE: String(scale) } : {}),
    ...extraEnv,
  };
  // --no-sandbox: Ubuntu (GitHub's Linux runners) blocks the user namespaces Electron's sandbox needs, so it
  // wouldn't start there. The app's own pages keep their per-page sandbox.
  const app = await playwright()._electron.launch({ args: ['--no-sandbox', ROOT], cwd: ROOT, env });
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
    if (process.env.PD_DEBUG_SIZE) console.log('window', got);
  }
  return {
    app,
    win,
    errors,
    data,
    /** Runs fn(pdDemo) in the main process. */
    demo: (fn, arg) => app.evaluate(new Function('electron', 'arg', `return (${fn.toString()})(global.pdDemo, arg)`), arg),
    /** Waits for the dashboard to show a drop being farmed; if it doesn't, says what the app logged. */
    async farming(timeout = 20000) {
      try {
        await until(win, () => document.querySelector('#hero .hero-title'), 'farming to start', timeout);
      } catch (err) {
        const log = await app.evaluate(() => global.pdDebug?.farmer.log.slice(-12).map((e) => `${e.level}: ${e.text}`)).catch(() => null);
        err.message += `. The app's last log lines:\n  ${(log ?? ['(none)']).join('\n  ')}`;
        throw err;
      }
    },
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
