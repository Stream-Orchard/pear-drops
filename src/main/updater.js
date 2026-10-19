// Updates from GitHub (ported from Stream Multiview): the pure parts, tested on their own.
// The newest Release on the repository (or, with no releases, package.json on the main
// branch) is compared with this copy. Installed apps update from the release's installer
// (on a Mac, the app itself from the -mac.zip, swapped in on restart); copies run from
// source get the new files copied over them, after a backup. Settings, history and the
// Kick login live in the data folder and are never touched.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const GITHUB = { api: 'https://api.github.com', raw: 'https://raw.githubusercontent.com' };
let API = GITHUB.api;
let RAW = GITHUB.raw;
let standIn = false;
/**
 * Tests point the updater at a stand-in GitHub on this computer (main.js only lets copies run from
 * source do it). Only then does a download from http://127.0.0.1 count.
 */
function useServer({ api, raw } = {}) {
  API = api || GITHUB.api;
  RAW = raw || GITHUB.raw;
  standIn = API !== GITHUB.api || RAW !== GITHUB.raw;
}
/** Where an update may come from: https, or the stand-in GitHub's own http://127.0.0.1. */
const downloadable = (url) => /^https:\/\//.test(url) || (standIn && /^http:\/\/127\.0\.0\.1[:/]/.test(url));
const REPO_RE = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const UA = 'Pear-Drops-Updater';

/** "2.10.1" vs "2.9" -> 1 / 0 / -1 */
function compareVersions(a, b) {
  const pa = String(a).replace(/^v/i, '').split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

const HDRS = { 'User-Agent': UA, Accept: 'application/vnd.github+json' };
// Releases also come with their notes as HTML, rendered and cleaned by GitHub.
const RELEASE_HDRS = { ...HDRS, Accept: 'application/vnd.github.full+json' };

/** The newest version: { version, zip, notes, notesHtml, name, source, page, published, assets }, or throws. */
async function latestInfo(repo, fetchFn) {
  if (!REPO_RE.test(repo || '')) throw new Error('repo');
  let r = await fetchFn(`${API}/repos/${repo}/releases/latest`, { headers: RELEASE_HDRS });
  if (r.ok) {
    const d = await r.json();
    if (d && d.tag_name && !d.draft) {
      return {
        version: String(d.tag_name).replace(/^v/i, ''),
        zip: d.zipball_url || `${API}/repos/${repo}/zipball/${encodeURIComponent(d.tag_name)}`,
        notes: String(d.body || '').slice(0, 4000),
        notesHtml: String(d.body_html || '').slice(0, 20000),
        name: d.name || d.tag_name,
        source: 'release',
        page: d.html_url || `https://github.com/${repo}/releases/latest`,
        published: d.published_at || null,
        assets: (Array.isArray(d.assets) ? d.assets : [])
          .map((x) => ({ name: String(x.name || ''), url: String(x.browser_download_url || ''), size: +x.size || 0 }))
          .filter((x) => downloadable(x.url)),
      };
    }
  } else if (r.status !== 404) throw new Error(`http ${r.status}`);
  // No releases: the version in package.json on the default branch.
  r = await fetchFn(`${API}/repos/${repo}`, { headers: HDRS });
  if (!r.ok) throw new Error(r.status === 404 ? 'notfound' : `http ${r.status}`);
  const info = await r.json();
  const branch = info.default_branch || 'main';
  r = await fetchFn(`${RAW}/${repo}/${encodeURIComponent(branch)}/package.json`, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`http ${r.status}`);
  const pkg = JSON.parse(await r.text());
  return {
    version: String(pkg.version || '0'),
    zip: `${API}/repos/${repo}/zipball/${encodeURIComponent(branch)}`,
    notes: '',
    notesHtml: '',
    name: `v${pkg.version}`,
    source: 'branch',
    page: `https://github.com/${repo}/releases`,
    published: null,
    assets: [],
  };
}

/** A minimal .zip reader (stored and deflate), enough for GitHub's source downloads. */
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
    p += 46 + nlen + elen + clen;
    if (name.endsWith('/')) continue;
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error('zip');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.slice(start, start + csize);
    const data = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : null;
    if (!data || data.length !== usize) throw new Error('zip');
    out.push({ name, data });
  }
  return out;
}

/** Files in the download -> { relativePath: Buffer }, without GitHub's "owner-repo-abc123/" top folder. */
function appFiles(entries) {
  const tops = new Set(entries.map((e) => e.name.split('/')[0]));
  const strip = tops.size === 1 && entries.every((e) => e.name.includes('/'));
  const files = {};
  for (const e of entries) {
    const rel = strip ? e.name.slice(e.name.indexOf('/') + 1) : e.name;
    if (!rel || rel.split('/').some((s) => s === '..' || s === '') || path.isAbsolute(rel)) continue;
    if (/^(node_modules|\.git|\.github)\//.test(rel)) continue;
    files[rel] = e.data;
  }
  if (!files['package.json']) {
    // The app sits in a sub-folder of the repository.
    const pk = Object.keys(files)
      .filter((k) => k.endsWith('/package.json'))
      .sort((x, y) => x.split('/').length - y.split('/').length)[0];
    if (pk) {
      const pre = pk.slice(0, -'package.json'.length);
      const sub = {};
      for (const [k, v] of Object.entries(files)) if (k.startsWith(pre)) sub[k.slice(pre.length)] = v;
      return sub;
    }
  }
  return files;
}

// The files the last update installed, kept in the app folder. The next update removes the
// ones it no longer has, and only those, so node_modules and anything else stay.
const FILE_LIST = '.pd-files.json';
const safeRel = (rel) => typeof rel === 'string' && !!rel && !path.isAbsolute(rel) && !rel.split(/[\\/]/).some((s) => s === '..' || s === '');

/** Copies the new files over appDir (backing up the old ones first). -> { version, needsInstall } */
function applyUpdate(appDir, files, backupDir) {
  if (!files['package.json']) throw new Error('nopkg');
  const pkg = JSON.parse(files['package.json'].toString('utf8'));
  const cur = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
  if (pkg.name !== cur.name) throw new Error('wrongapp');
  // The start file (package.json "main") and the app's page must both be there.
  const mainFile = String(pkg.main || 'main.js').replace(/^\.\//, '');
  if (!files[mainFile] || !files['src/renderer/index.html']) throw new Error('incomplete');
  const deps = (p) => JSON.stringify([p.dependencies || {}, p.devDependencies || {}]);
  const needsInstall = deps(pkg) !== deps(cur);
  fs.mkdirSync(backupDir, { recursive: true });
  const written = [];
  try {
    for (const [rel, data] of Object.entries(files)) {
      const dest = path.join(appDir, ...rel.split('/'));
      if (!dest.startsWith(path.resolve(appDir) + path.sep)) continue;
      if (fs.existsSync(dest)) {
        const bk = path.join(backupDir, ...rel.split('/'));
        fs.mkdirSync(path.dirname(bk), { recursive: true });
        fs.copyFileSync(dest, bk);
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(`${dest}.pd-new`, data);
      written.push(dest);
    }
  } catch (e) {
    for (const dest of written) fs.rmSync(`${dest}.pd-new`, { force: true });
    throw e;
  }
  // Swap them all in at the end; if that fails part way, put back what was swapped.
  const swapped = [];
  try {
    for (const dest of written) {
      fs.renameSync(`${dest}.pd-new`, dest);
      swapped.push(dest);
    }
  } catch (e) {
    for (const dest of swapped) {
      const bk = path.join(backupDir, path.relative(appDir, dest));
      try {
        if (fs.existsSync(bk)) fs.copyFileSync(bk, dest);
        else fs.unlinkSync(dest);
      } catch {}
    }
    for (const dest of written) fs.rmSync(`${dest}.pd-new`, { force: true });
    throw e;
  }
  // Files an earlier update installed that this version no longer has: removed, after a backup.
  const root = path.resolve(appDir);
  const listFile = path.join(root, FILE_LIST);
  let before = [];
  try {
    const l = JSON.parse(fs.readFileSync(listFile, 'utf8'));
    if (Array.isArray(l)) before = l;
  } catch {}
  for (const rel of before) {
    if (!safeRel(rel) || files[rel] || /^(node_modules|\.git)(\/|$)/.test(rel)) continue;
    const old = path.join(root, ...rel.split('/'));
    if (!old.startsWith(root + path.sep)) continue;
    try {
      if (!fs.existsSync(old) || !fs.statSync(old).isFile()) continue;
      const bk = path.join(backupDir, ...rel.split('/'));
      fs.mkdirSync(path.dirname(bk), { recursive: true });
      fs.copyFileSync(old, bk);
      fs.unlinkSync(old);
      for (let d = path.dirname(old); d !== root && d.startsWith(root + path.sep) && !fs.readdirSync(d).length; d = path.dirname(d)) fs.rmdirSync(d);
    } catch {}
  }
  try {
    fs.writeFileSync(listFile, JSON.stringify(written.map((d) => path.relative(root, d).split(path.sep).join('/'))));
  } catch {}
  if (needsInstall) fs.writeFileSync(path.join(appDir, '.needs-install'), 'The app engine changed in this update: the launcher reinstalls it.\n');
  return { version: String(pkg.version), needsInstall };
}

/** Installed builds update from the matching installer in the release. */
function pickInstaller(assets, platform) {
  const list = Array.isArray(assets) ? assets : [];
  if (platform === 'win32') return list.find((a) => /setup.*\.exe$/i.test(a.name)) || list.find((a) => /\.exe$/i.test(a.name)) || null;
  if (platform === 'darwin') return list.find((a) => /(mac|universal).*\.dmg$/i.test(a.name)) || list.find((a) => /\.dmg$/i.test(a.name)) || null;
  return null;
}

/** Mac: the release also carries the app itself as a .zip, which the app swaps in for itself. */
function pickMacZip(assets) {
  const list = Array.isArray(assets) ? assets : [];
  return list.find((a) => /(mac|universal).*\.zip$/i.test(a.name)) || null;
}

/** ".../Pear Drops.app/Contents/MacOS/Pear Drops" -> ".../Pear Drops.app" */
function macAppBundle(execPath) {
  const m = String(execPath || '').match(/^(.*?\.app)\/Contents\/MacOS\/[^/]+$/);
  return m ? m[1] : '';
}

/** `codesign -d -r- <app>` output -> the requirement macOS knows the app by ('' if none). */
function designatedReq(out) {
  const m = String(out || '').match(/designated => (.+)/);
  return m ? m[1].trim() : '';
}

/** Why this copy can't replace itself (it falls back to the disk image), or '' if it can. */
function macSwapBlocker({ app, writable, req }) {
  if (!app) return 'nobundle';
  if (app.startsWith('/Volumes/')) return 'volume'; // running from the disk image
  if (/\/AppTranslocation\//.test(app)) return 'translocated'; // macOS runs it from a read-only copy
  if (!writable) return 'nowrite';
  if (!req) return 'unsigned';
  if (/^cdhash /.test(req)) return 'adhoc'; // ad-hoc signed: a new build can't be told from a fake
  return '';
}

/**
 * Unpacks the downloaded app and checks it's signed by the same certificate as this one
 * (`req`, the running app's designated requirement), so it's really ours and macOS lets
 * it read the saved login. -> the new .app
 */
async function unpackMacApp(zip, dir, req, run) {
  await run('ditto', ['-x', '-k', zip, dir]);
  const name = fs.readdirSync(dir).find((f) => f.endsWith('.app'));
  if (!name) throw new Error('no app in the download');
  const app = path.join(dir, name);
  await run('codesign', ['--verify', '--deep', '--strict', `-R=${req}`, app]);
  return app;
}

/** Mac: can this app change its own files? macOS's App Management setting can refuse it. */
function canWriteInside(appDir) {
  const f = path.join(appDir, '.pd-update-check');
  try {
    fs.writeFileSync(f, '');
  } catch (e) {
    if (e && (e.code === 'EPERM' || e.code === 'EACCES')) return false;
    throw e;
  }
  fs.rmSync(f, { force: true });
  return true;
}

/**
 * Run detached after the app quits: $1 the app's process, $2 the app, $3 the new app, $4 what
 * opens it again. The old app is only deleted once the new one is in place; if the move
 * fails, the old one goes back.
 */
function macSwapScript() {
  return `#!/bin/sh
pid="$1"; app="$2"; new="$3"; open="\${4:-open}"; old="$app.pd-old-$$"
i=0
while kill -0 "$pid" 2>/dev/null; do
  i=$((i + 1)); [ "$i" -gt 600 ] && exit 1
  sleep 0.1
done
if mv "$app" "$old"; then
  if mv "$new" "$app"; then rm -rf "$old"; else rm -rf "$app"; mv "$old" "$app"; fi
fi
xattr -dr com.apple.quarantine "$app" 2>/dev/null
"$open" "$app"
`;
}

/**
 * Saves a download to disk without holding it all in memory, reporting progress (0..1)
 * when the size is known.
 */
async function downloadTo(fetchFn, url, file, onProgress = () => {}) {
  if (!downloadable(String(url))) throw new Error('download: not https');
  const r = await fetchFn(url, { headers: { 'User-Agent': UA } });
  if (!r.ok || !r.body) throw new Error(`download ${r.status}`);
  const total = Number(r.headers.get('content-length')) || 0;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.part`;
  const out = fs.createWriteStream(tmp);
  const reader = r.body.getReader();
  let got = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (total) onProgress(Math.min(1, got / total));
      if (!out.write(Buffer.from(value))) await new Promise((res) => out.once('drain', res));
    }
  } finally {
    await new Promise((res) => out.end(res));
  }
  fs.renameSync(tmp, file);
  return file;
}

module.exports = {
  useServer,
  REPO_RE,
  UA,
  compareVersions,
  latestInfo,
  readZip,
  appFiles,
  applyUpdate,
  pickInstaller,
  pickMacZip,
  macAppBundle,
  designatedReq,
  macSwapBlocker,
  unpackMacApp,
  canWriteInside,
  macSwapScript,
  downloadTo,
};
