// Smooth capture: every frame the main window paints (Electron's frame
// subscription), saved as JPEGs with their real times, listed for ffmpeg with
// each frame's duration. A still screen is re-grabbed so timing stays right.
const fs = require('fs');
const path = require('path');

async function start(app, dir, { fps = 30, quality = 85 } = {}) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  await app.evaluate(({ BrowserWindow }, { dir, fps, quality }) => {
    const fs = process.getBuiltinModule('fs');
    const p = process.getBuiltinModule('path');
    const w = BrowserWindow.getAllWindows().find((x) => /index\.html$/.test(x.webContents.getURL()));
    const cap = (globalThis.__cap = { frames: [], n: 0, last: 0, t0: Date.now(), wc: w.webContents });
    const grab = (img) => {
      const now = Date.now();
      if (now - cap.last < 1000 / fps - 4) return;
      cap.last = now;
      const f = `${String(cap.n++).padStart(6, '0')}.jpg`;
      cap.frames.push([f, now - cap.t0]);
      fs.writeFile(p.join(dir, f), img.toJPEG(quality), () => {});
    };
    w.webContents.beginFrameSubscription(false, grab);
    cap.keep = setInterval(() => {
      if (Date.now() - cap.last > 200) w.webContents.capturePage().then(grab).catch(() => {});
    }, 200);
  }, { dir, fps, quality });
}

async function stop(app, dir) {
  const r = await app.evaluate(() => {
    const c = globalThis.__cap;
    clearInterval(c.keep);
    try {
      c.wc.endFrameSubscription();
    } catch {}
    return { frames: c.frames, end: Date.now() - c.t0, t0: c.t0 };
  });
  await new Promise((res) => setTimeout(res, 1500));
  const q = (f) => `file '${path.join(dir, f).replace(/\\/g, '/').replace(/'/g, "'\\''")}'`;
  const durs = r.frames.map(([, t], i) => ((r.frames[i + 1]?.[1] ?? r.end) - t) / 1000);
  const lines = r.frames.map(([f], i) => `${q(f)}\nduration ${durs[i].toFixed(4)}`);
  lines.push(q(r.frames.at(-1)[0]));
  fs.writeFileSync(path.join(dir, 'list.txt'), lines.join('\n') + '\n');
  const seconds = r.end / 1000;
  return { list: path.join(dir, 'list.txt'), count: r.frames.length, seconds, fps: +(r.frames.length / seconds).toFixed(1), maxGap: +Math.max(...durs).toFixed(2), t0: r.t0 };
}

module.exports = { start, stop };
