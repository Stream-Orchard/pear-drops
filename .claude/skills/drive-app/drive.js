// Drives the real app in demo mode for screenshots and videos (see SKILL.md).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { launchApp } = require('../../../test/launch/app');

const outDir = () => {
  const dir = path.join(os.tmpdir(), 'kick-drops-captures');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

async function launch({ size = [1512, 944], visible = false, mirror = true, signedIn = true, seed = true } = {}) {
  if (visible) process.env.KDF_TEST_VISIBLE = '1';
  const a = await launchApp({ size: { width: size[0], height: size[1] }, mirror, signedIn, seed, hidden: !visible });
  await a.win.waitForFunction(() => document.querySelector('#hero .hero-title') || !document.querySelector('#welcome').hidden, null, { timeout: 30000 });
  return {
    ...a,
    async shot(name) {
      const file = path.join(outDir(), `${name}.png`);
      await a.win.screenshot({ path: file });
      return file;
    },
    /** Records `fn` as an MP4 of every frame the window paints. */
    async record(name, fn, { fps = 30 } = {}) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kdf-frames-'));
      await a.app.evaluate(({ BrowserWindow }, { dir, fps }) => {
        const fs = process.getBuiltinModule('fs');
        const p = process.getBuiltinModule('path');
        const w = BrowserWindow.getAllWindows().find((x) => /index\.html$/.test(x.webContents.getURL()));
        const cap = (globalThis.__cap = { n: 0, last: 0, t0: Date.now(), list: [], wc: w.webContents });
        w.webContents.beginFrameSubscription(false, (img) => {
          const now = Date.now();
          if (now - cap.last < 1000 / fps - 4) return;
          cap.last = now;
          const f = `${String(cap.n++).padStart(6, '0')}.jpg`;
          cap.list.push([f, now - cap.t0]);
          fs.writeFileSync(p.join(dir, f), img.toJPEG(90));
        });
      }, { dir, fps });
      await fn();
      const frames = await a.app.evaluate(() => {
        const c = globalThis.__cap;
        c.wc.endFrameSubscription();
        return { list: c.list, end: Date.now() - c.t0 };
      });
      const lines = frames.list.map(([f, t], i) => `file '${path.join(dir, f)}'\nduration ${(((frames.list[i + 1]?.[1] ?? frames.end) - t) / 1000).toFixed(4)}`);
      lines.push(`file '${path.join(dir, frames.list.at(-1)[0])}'`);
      fs.writeFileSync(path.join(dir, 'list.txt'), lines.join('\n'));
      const out = path.join(outDir(), `${name}.mp4`);
      spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'), '-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', out], { stdio: 'inherit' });
      fs.rmSync(dir, { recursive: true, force: true });
      return out;
    },
  };
}

module.exports = { launch, outDir };
