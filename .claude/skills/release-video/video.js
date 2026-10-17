// Records a trailer / walkthrough of the real app from a scenes file (see SKILL.md):
// title cards, captions, a spotlight ring, a visible pointer, camera zooms, the menu
// bar popover composited in, smooth frame capture, a synthesized soundtrack with
// impacts on every card, and the app's own alert chime. Writes an MP4.
//   node .claude/skills/release-video/video.js <scenes.js> [--out <file.mp4>] [--keep]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { launchApp } = require('../../../test/launch/app');
const capture = require('./capture');
const music = require('./music');

const W = 1440;
const H = 900;
const SCALE = 1.3333; // frames come out at 1920×1200

const CSS = `
#tr-card{position:fixed;inset:0;z-index:2147483646;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;pointer-events:none;
  background:radial-gradient(60% 55% at 50% 42%,#14240c 0%,#07090a 70%);color:#fff;font-family:-apple-system,'SF Pro Display',system-ui,sans-serif;
  clip-path:circle(0% at 50% 45%);transition:clip-path .8s cubic-bezier(.7,0,.25,1)}
#tr-card.on{clip-path:circle(85% at 50% 45%)}
#tr-card::before{content:'';position:absolute;inset:0;background-image:linear-gradient(rgba(83,252,24,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(83,252,24,.05) 1px,transparent 1px);background-size:48px 48px;mask-image:radial-gradient(50% 50% at 50% 45%,#000 0%,transparent 75%)}
#tr-card .glow{position:absolute;width:640px;height:640px;left:50%;top:45%;margin:-320px 0 0 -320px;border-radius:50%;background:radial-gradient(circle,rgba(83,252,24,.28) 0%,transparent 62%);animation:trGlow 3.2s ease-in-out infinite alternate}
@keyframes trGlow{from{transform:scale(.85);opacity:.55}to{transform:scale(1.15);opacity:1}}
#tr-card .mark{position:relative;width:96px;height:96px;animation:trPop .8s cubic-bezier(.3,1.6,.5,1) both;filter:drop-shadow(0 18px 50px rgba(83,252,24,.55))}
#tr-card .mark svg{width:100%;height:100%}
@keyframes trPop{0%{transform:scale(0) rotate(-20deg)}100%{transform:none}}
#tr-card .kicker{position:relative;font:800 13px/1 -apple-system,system-ui;letter-spacing:.32em;text-transform:uppercase;color:#53fc18;opacity:0;animation:trFade .6s ease .25s both}
#tr-card h1{position:relative;margin:0;font-size:64px;font-weight:800;letter-spacing:-.04em;display:flex;gap:.26em;flex-wrap:wrap;justify-content:center;max-width:1100px;line-height:1.05}
#tr-card h1 span{display:inline-block;animation:trWord .7s cubic-bezier(.2,.9,.3,1.15) both}
#tr-card h1 em{font-style:normal;background:linear-gradient(100deg,#b6ff8f,#53fc18 45%,#2ee6c5);-webkit-background-clip:text;color:transparent}
@keyframes trWord{from{opacity:0;transform:translateY(34px);filter:blur(10px)}to{opacity:1;transform:none;filter:none}}
#tr-card p{position:relative;margin:0;font-size:21px;max-width:820px;text-align:center;color:#b4bac3;line-height:1.5;opacity:0;animation:trFade .7s ease both}
@keyframes trFade{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
#tr-card ul{position:relative;margin:6px 0 0;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:10px;justify-content:center;max-width:980px}
#tr-card li{opacity:0;animation:trFade .5s ease both;padding:8px 14px;border-radius:999px;border:1px solid rgba(83,252,24,.28);background:rgba(83,252,24,.07);color:#d8ffc8;font-size:15px;font-weight:600}
#tr-card .dots{position:absolute;bottom:44px;display:flex;gap:10px}
#tr-card .dots i{width:8px;height:8px;border-radius:50%;background:#ffffff26;transition:all .4s}
#tr-card .dots i.done{background:rgba(83,252,24,.5)}
#tr-card .dots i.cur{background:#53fc18;transform:scale(1.5);box-shadow:0 0 14px #53fc18}
#tr-card.still *{animation:none!important;opacity:1!important}
#tr-cap{position:fixed;left:50%;bottom:28px;transform:translate(-50%,24px);opacity:0;z-index:2147483645;pointer-events:none;transition:all .5s cubic-bezier(.2,.8,.2,1),bottom .6s cubic-bezier(.6,0,.3,1);
  display:flex;align-items:center;gap:14px;padding:14px 22px 14px 16px;border-radius:18px;background:rgba(10,12,14,.9);border:1px solid rgba(83,252,24,.45);box-shadow:0 20px 60px rgba(0,0,0,.6),0 0 40px rgba(83,252,24,.12);
  backdrop-filter:blur(16px);font-family:-apple-system,system-ui;color:#fff;max-width:900px}
#tr-cap.on{opacity:1;transform:translate(-50%,0)}
#tr-cap.top{bottom:calc(100% - 140px)}
#tr-cap .n{display:grid;place-items:center;width:34px;height:34px;border-radius:11px;background:#53fc18;color:#071204;font:800 15px -apple-system,system-ui;flex:none}
#tr-cap b{display:block;font-size:19px;letter-spacing:-.01em}
#tr-cap span{display:block;font-size:14px;color:#a8afb8;margin-top:2px}
#tr-ring{position:fixed;border:2.5px solid #53fc18;border-radius:14px;z-index:2147483644;pointer-events:none;box-shadow:0 0 0 9999px rgba(3,4,5,.55),0 0 28px rgba(83,252,24,.6);opacity:0;transition:opacity .45s,left .6s cubic-bezier(.6,0,.3,1),top .6s cubic-bezier(.6,0,.3,1),width .6s cubic-bezier(.6,0,.3,1),height .6s cubic-bezier(.6,0,.3,1)}
#tr-ring.on{opacity:1}
#tr-mouse{position:fixed;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(255,255,255,.92);border:2px solid #0a0b0d;box-shadow:0 4px 14px rgba(0,0,0,.5);z-index:2147483647;pointer-events:none;transition:transform .12s;left:-60px;top:-60px}
#tr-mouse.down{transform:scale(.7);background:#53fc18}
#tr-card.on ~ #tr-mouse{opacity:0}
#tr-mouse::after{content:'';position:absolute;inset:-8px;border-radius:50%;border:2px solid #53fc18;opacity:0}
#tr-mouse.down::after{animation:trClick .5s ease-out}
@keyframes trClick{from{opacity:1;transform:scale(.5)}to{opacity:0;transform:scale(1.6)}}
#app.tr-cam{transform-origin:0 0;transition:transform 1.15s cubic-bezier(.65,0,.3,1)}
#tr-bar{position:fixed;left:0;right:0;top:0;height:30px;z-index:2147483643;display:flex;align-items:center;justify-content:flex-end;gap:16px;padding:0 16px;
  background:rgba(30,32,36,.72);backdrop-filter:blur(24px) saturate(1.6);font:600 13px -apple-system,system-ui;color:#e8eaed;transform:translateY(-100%);transition:transform .6s cubic-bezier(.2,.8,.2,1)}
#tr-bar.on{transform:none}
#tr-bar .ring{display:flex;align-items:center;gap:6px;padding:2px 8px;border-radius:6px;background:rgba(255,255,255,.14)}
#tr-pop{position:fixed;top:36px;z-index:2147483643;width:360px;border-radius:16px;overflow:hidden;background:rgba(20,22,26,.97);backdrop-filter:blur(30px);border:1px solid rgba(255,255,255,.12);box-shadow:0 30px 80px rgba(0,0,0,.7);transform-origin:top center;transform:translateY(-10px) scale(.96);opacity:0;transition:all .45s cubic-bezier(.2,.8,.2,1)}
#tr-pop.on{transform:none;opacity:1}
#tr-pop img{display:block;width:100%}
`;

// The title cards show the app's own mark (brandMark in src/renderer/icons.js), so they always match it.

function ff(args) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status) throw new Error(`ffmpeg: ${r.stderr}`);
}

/** The helpers a scenes file's run(t) gets. */
function director(a, { steps = 0 } = {}) {
  const m = a.win;
  const wait = (ms) => m.waitForTimeout(ms);
  const cues = [];
  let mx = W / 2;
  let my = H / 2;
  let dot = 0;
  const ease = (k) => k * k * (3 - 2 * k);

  // Title card: { kicker, h (words; *word* is highlighted), p, items, still }
  const card = (o) => {
    cues.push(Date.now());
    return m.evaluate(
      ({ o, dots, dot }) => {
        const c = document.getElementById('tr-card');
        // *highlighted* runs may span several words.
        let hot = false;
        const words = o.h.split(' ').map((w, i) => {
          const starts = w.startsWith('*');
          const ends = w.endsWith('*');
          const text = w.replace(/^\*|\*$/g, '');
          const on = hot || starts;
          if (starts) hot = true;
          if (ends) hot = false;
          return `<span style="animation-delay:${(0.3 + i * 0.08).toFixed(2)}s">${on ? `<em>${text}</em>` : text}</span>`;
        });
        let h = `<div class="glow"></div><div class="mark">${window.brandMark(96)}</div>`;
        if (o.kicker) h += `<div class="kicker">${o.kicker}</div>`;
        h += `<h1>${words.join('')}</h1>`;
        if (o.p) h += `<p style="animation-delay:${(0.55 + words.length * 0.08).toFixed(2)}s">${o.p}</p>`;
        if (o.items) h += `<ul>${o.items.map((t, i) => `<li style="animation-delay:${(1.1 + i * 0.12).toFixed(2)}s">${t}</li>`).join('')}</ul>`;
        if (dots) h += `<div class="dots">${Array.from({ length: dots }, (_, i) => `<i class="${i < dot ? 'done' : i === dot ? 'cur' : ''}"></i>`).join('')}</div>`;
        c.innerHTML = h;
        c.classList.toggle('still', !!o.still);
        c.classList.add('on');
      },
      { o, dots: o.noDots ? 0 : steps, dot: o.noDots ? 0 : dot },
    );
  };
  const uncard = () => m.evaluate(() => document.getElementById('tr-card').classList.remove('on'));
  const cap = (title, sub = '', n = dot) =>
    m.evaluate(
      ([title, sub, n]) => {
        const c = document.getElementById('tr-cap');
        c.classList.remove('on');
        setTimeout(() => {
          c.innerHTML = `<span class="n">${n}</span><div><b>${title}</b>${sub ? `<span>${sub}</span>` : ''}</div>`;
          c.classList.add('on');
        }, 260);
      },
      [title, sub, n],
    );
  const uncap = () => m.evaluate(() => document.getElementById('tr-cap').classList.remove('on'));
  const capTop = (on) => m.evaluate((on) => document.getElementById('tr-cap').classList.toggle('top', on), on);

  // A step: its card, then the same words as a caption over the demo.
  const step = async (title, sub, { kicker } = {}) => {
    await uncap();
    await unring();
    await card({ kicker: kicker ?? `Step ${dot + 1}`, h: title, p: sub });
    await wait(2600);
    await uncard();
    await wait(850);
    dot += 1;
    await cap(title.replace(/\*/g, ''), sub, dot);
    await wait(400);
  };

  const ring = async (sel, pad = 8) => {
    const r = await m.locator(sel).first().boundingBox();
    await capTop(r.y + r.height > H * 0.72);
    await m.evaluate(
      ([r, pad]) => {
        const g = document.getElementById('tr-ring');
        // A ring that isn't showing jumps straight there; one that is glides over.
        if (!g.classList.contains('on')) g.style.transition = 'opacity .45s';
        Object.assign(g.style, { left: `${r.x - pad}px`, top: `${r.y - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
        void g.offsetWidth;
        g.style.transition = '';
        g.classList.add('on');
      },
      [r, pad],
    );
  };
  const unring = () => m.evaluate(() => document.getElementById('tr-ring').classList.remove('on'));

  // Camera: zoom the whole app onto an element (scale), or back out.
  const zoom = async (sel, scale = 1.5, ms = 1300) => {
    await unring();
    await m.evaluate(
      ([sel, s, W, H]) => {
        const app = document.getElementById('app');
        app.classList.add('tr-cam');
        app.style.transform = '';
        const r = document.querySelector(sel).getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const tx = Math.min(0, Math.max(W - s * W, W / 2 - s * cx));
        const ty = Math.min(0, Math.max(H - s * H, H / 2 - s * cy));
        app.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
      },
      [sel, scale, W, H],
    );
    await wait(ms);
  };
  const unzoom = async (ms = 1200) => {
    await m.evaluate(() => (document.getElementById('app').style.transform = ''));
    await wait(ms);
  };

  const glide = async (x, y, { steps: n = 22 } = {}) => {
    const x0 = mx;
    const y0 = my;
    for (let i = 1; i <= n; i++) {
      const k = ease(i / n);
      await m.mouse.move(x0 + (x - x0) * k, y0 + (y - y0) * k);
      await wait(12);
    }
    mx = x;
    my = y;
  };
  const moveTo = async (sel, { fx = 0.5, fy = 0.5, ...o } = {}) => {
    const box = await m.locator(sel).first().boundingBox();
    if (!box) throw new Error(`Nothing on screen for ${sel}`);
    await capTop(box.y + box.height > H * 0.72);
    await glide(box.x + box.width * fx, box.y + box.height * fy, o);
  };
  const press = async () => {
    await wait(140);
    await m.mouse.down();
    await wait(90);
    await m.mouse.up();
    await wait(260);
  };
  const click = async (sel, o) => {
    await moveTo(sel, o);
    await press();
  };
  // Drag from one element to another with the visible pointer (the queue's own pointer drag):
  // press, lift, carry it over slowly so the lifted card and drop marker show, drop.
  const drag = async (from, to, { fy = 0.15 } = {}) => {
    // Grab what's on screen: a row scrolled out of its list can't be pressed.
    await m.locator(from).first().scrollIntoViewIfNeeded();
    await m.locator(to).first().scrollIntoViewIfNeeded();
    await wait(300);
    await moveTo(from, { fx: 0.04 });
    await wait(250);
    await m.mouse.down();
    await wait(120);
    await glide(mx, my - 4, { steps: 3 }); // starts the drag
    await wait(250);
    const box = await m.locator(to).first().boundingBox();
    await glide(box.x + 20, box.y + box.height * fy, { steps: 45 });
    await wait(450);
    await m.mouse.up();
    await wait(500);
  };

  /** The menu bar popover: shown over the app as a mock menu bar and dropdown. */
  const trayPopover = async (on = true) => {
    if (!on) {
      await m.evaluate(() => {
        document.getElementById('tr-pop')?.classList.remove('on');
        document.getElementById('tr-bar')?.classList.remove('on');
      });
      return wait(600);
    }
    await a.demo((d) => d.openTray());
    await wait(900);
    const png = await a.app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => /tray\.html$/.test(x.webContents.getURL()));
      const img = await w.webContents.capturePage();
      return img.toPNG().toString('base64');
    });
    await m.evaluate(
      ({ png, pct }) => {
        const bar = document.getElementById('tr-bar');
        const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        bar.innerHTML = `<span class="ring"><svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.6" fill="none" stroke="rgba(255,255,255,.3)" stroke-width="2"/><circle cx="8" cy="8" r="5.6" fill="none" stroke="#53fc18" stroke-width="2" stroke-dasharray="35.2" stroke-dashoffset="${35.2 * (1 - pct)}" transform="rotate(-90 8 8)"/><circle cx="8" cy="8" r="1.8" fill="#53fc18"/></svg>${Math.round(pct * 100)}%</span><span>Fri ${time}</span>`;
        bar.classList.add('on');
        const pop = document.getElementById('tr-pop');
        pop.innerHTML = `<img src="data:image/png;base64,${png}">`;
        const ring = bar.querySelector('.ring').getBoundingClientRect();
        pop.style.left = `${Math.min(innerWidth - 372, ring.left + ring.width / 2 - 180)}px`;
        setTimeout(() => pop.classList.add('on'), 450);
      },
      { png, pct: await a.demo((d) => d.farmer.trayInfo().fraction) },
    );
    await wait(1200);
  };

  return { m, a, W, H, wait, card, uncard, cap, uncap, step, ring, unring, zoom, unzoom, glide, moveTo, press, click, drag, trayPopover, cues, demo: a.demo };
}

async function record(scenes, { out, keep = false } = {}) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  if (!/libx264/.test(r.stdout || '')) throw new Error('ffmpeg with libx264 is needed (brew install ffmpeg)');
  const name = scenes.name || 'pear-drops-trailer';
  const work = path.join(os.tmpdir(), 'pear-drops-video', name);
  fs.mkdirSync(work, { recursive: true });
  const frames = path.join(work, 'frames');
  const mp4 = out || path.join(os.tmpdir(), 'pear-drops-video', `${name}.mp4`);
  const thumb = path.join(work, 'thumbnail.png');

  // Hidden (never takes focus) and muted: the soundtrack is made afterwards.
  const a = await launchApp({ signedIn: scenes.signedIn ?? false, seed: true, mirror: true, scale: SCALE, size: { width: W, height: H }, eventSeconds: 3600 });
  const m = a.win;
  let cap = null;
  let failed = null;
  let t = null;
  try {
    await m.evaluate(({ css }) => {
      const st = document.createElement('style');
      st.textContent = css;
      document.head.appendChild(st);
      document.body.insertAdjacentHTML('beforeend', '<div id="tr-bar"></div><div id="tr-pop"></div><div id="tr-ring"></div><div id="tr-cap"></div><div id="tr-card" class="on"></div><div id="tr-mouse"></div>');
      const ms = document.getElementById('tr-mouse');
      document.addEventListener('pointermove', (e) => ((ms.style.left = `${e.clientX}px`), (ms.style.top = `${e.clientY}px`)), true);
      document.addEventListener('dragover', (e) => ((ms.style.left = `${e.clientX}px`), (ms.style.top = `${e.clientY}px`)), true);
      document.addEventListener('pointerdown', () => ms.classList.add('down'), true);
      document.addEventListener('pointerup', () => ms.classList.remove('down'), true);
      // Remember when the app's alert chime plays, for the soundtrack.
      window.__chimes = [];
      const play = window.playAlert;
      window.playAlert = (...args) => {
        window.__chimes.push(Date.now());
        return play(...args);
      };
    }, { css: CSS });
    t = director(a, { steps: scenes.steps });
    // Poster: the first frame and the thumbnail.
    await t.card({ still: true, noDots: true, ...scenes.poster });
    await m.waitForTimeout(600);
    await m.screenshot({ path: thumb });
    await capture.start(a.app, frames);
    await m.waitForTimeout(1200);
    await scenes.run(t);
    await m.waitForTimeout(1200);
  } catch (e) {
    failed = e;
    await m.screenshot({ path: path.join(work, 'fail.png') }).catch(() => {});
  } finally {
    try {
      cap = await capture.stop(a.app, frames);
    } catch (e) {
      failed ??= e;
    }
  }
  const chimes = await m.evaluate(() => window.__chimes || []).catch(() => []);
  await a.close();
  if (failed) {
    failed.message += `\n(screenshot: ${path.join(work, 'fail.png')})`;
    throw failed;
  }

  const rel = (ts) => ts.map((x) => (x - cap.t0) / 1000).filter((x) => x > 0.3);
  const wav = music.write(cap.seconds + 0.5, path.join(work, 'music.wav'), { hits: rel(t.cues).map((x) => x + 0.05), chimes: rel(chimes) });
  ff(['-f', 'concat', '-safe', '0', '-i', cap.list, '-i', wav, '-map', '0:v:0', '-map', '1:a:0', '-vf', 'fps=30,scale=1920:1200:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', mp4]);
  const sheet = path.join(work, 'sheet.png');
  ff(['-i', mp4, '-vf', `fps=1/4,scale=480:-1,tile=6x${Math.ceil(cap.seconds / 24)}`, '-frames:v', '1', sheet]);
  if (!keep) fs.rmSync(frames, { recursive: true, force: true });
  return { mp4, thumbnail: thumb, sheet, capture: cap, cues: rel(t.cues), chimes: rel(chimes) };
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const opt = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv.splice(i, 2)[1] : undefined;
  };
  const out = opt('--out');
  const keep = argv.includes('--keep');
  const file = argv.find((x) => !x.startsWith('--'));
  if (!file) {
    console.log('Usage: node video.js <scenes.js> [--out file.mp4] [--keep]');
    process.exit(1);
  }
  record(require(path.resolve(file)), { out: out && path.resolve(out), keep })
    .then((r) => {
      console.log(`MP4:       ${r.mp4}\nThumbnail: ${r.thumbnail}\nSheet:     ${r.sheet}`);
      console.log(`Capture:   ${r.capture.seconds.toFixed(1)} s, ${r.capture.fps} fps, longest still ${r.capture.maxGap} s`);
      console.log(`Cards at:  ${r.cues.map((x) => x.toFixed(1)).join(', ')} s · chimes at ${r.chimes.map((x) => x.toFixed(1)).join(', ') || 'none'}`);
    })
    .catch((e) => {
      console.error(e.stack || e.message);
      process.exit(1);
    });
}

module.exports = { record, director };
