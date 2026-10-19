// The update flow: checks GitHub on a schedule, downloads and installs new versions,
// and remembers the version last run, so the app can show what's new after an update.
// The pure parts (GitHub, zips, signatures) are in updater.js.
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const updater = require('./updater');

const HOUR = 3600_000;
const CHECK_EVERY = 5.5 * HOUR;

/** CHANGELOG.md -> [{ version, current, items: [..] }], newest first. */
function parseChangelog(text) {
  const out = [];
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    const head = line.match(/^##\s+v?(\d+\.\d+\.\d+)\s*(\(current\))?/i);
    if (head) out.push({ version: head[1], current: !!head[2], items: [] });
    else if (out.length && /^[-*]\s+/.test(line)) out.at(-1).items.push(line.replace(/^[-*]\s+/, ''));
  }
  return out;
}

/** GitHub names are the same whatever their case. */
const sameRepo = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

class Updates extends EventEmitter {
  /**
   * deps: version, installed (a packaged app), platform, appRoot, dataDir, saved (where its
   * settings are kept: { load(), save(value) }, a db.js slot), execPath, pid,
   * pkgRepo, formerRepos (the names pkgRepo had before, which installs may have saved as
   * their repository), devCopy (a git checkout or dev copy: check only, never install), and the
   * side effects: fetch, runTool, spawn, openExternal, openPath, quit, relaunch, tempDir,
   * downloadsDir.
   */
  constructor(deps) {
    super();
    this.d = deps;
    this.cfg = { repo: '', auto: true, lastCheck: 0, seenVersion: null };
    this.st = { state: 'idle', latest: null, notes: '', notesHtml: '', error: '', installed: null, needsInstall: false, progress: null };
    this.justUpdated = null;
    this.lastProgressAt = 0;
  }

  load() {
    let saved = {};
    try {
      saved = this.d.saved.load() || {};
    } catch {}
    const ok = (r) => updater.REPO_RE.test(r || '');
    // A repository saved under one of the app's former names is its home one, moved: it follows.
    const moved = (this.d.formerRepos || []).some((r) => sameRepo(r, saved.repo));
    this.cfg = {
      repo: ok(saved.repo) && !moved ? saved.repo : this.homeRepo(),
      auto: saved.auto !== false,
      lastCheck: +saved.lastCheck || 0,
      seenVersion: saved.seenVersion ?? null,
    };
    // First start of a new version: say so once.
    if (this.cfg.seenVersion && updater.compareVersions(this.d.version, this.cfg.seenVersion) > 0) this.justUpdated = { from: this.cfg.seenVersion, to: this.d.version };
    this.cfg.seenVersion = this.d.version;
    this.save();
    return this;
  }

  /** The repository this copy was built from ('' if none). */
  homeRepo() {
    return updater.REPO_RE.test(this.d.pkgRepo || '') ? this.d.pkgRepo : '';
  }

  /** Saves the settings; the repository only if it was picked, so the home one can move. */
  save() {
    const { repo, ...rest } = this.cfg;
    try {
      this.d.saved.save(sameRepo(repo, this.homeRepo()) ? rest : this.cfg);
    } catch {}
  }

  status() {
    const { swap, installerFile, zip, ...st } = this.st;
    return {
      current: this.d.version,
      repo: this.cfg.repo,
      // The repository this copy was built from: updates from any other one get a warning.
      homeRepo: this.homeRepo(),
      auto: this.cfg.auto,
      lastCheck: this.cfg.lastCheck,
      devCopy: !!this.d.devCopy,
      installedApp: !!this.d.installed,
      platform: this.d.platform,
      swap: !!swap,
      justUpdated: this.justUpdated,
      ...st,
    };
  }

  set(patch) {
    this.st = { ...this.st, ...patch };
    this.emit('status', this.status());
  }

  /** Starts the schedule: shortly after launch, then every half hour if it's been a while. */
  start() {
    this.startTimer = setTimeout(() => this.cfg.auto && this.cfg.repo && this.check(), 12_000);
    this.interval = setInterval(() => {
      if (this.cfg.auto && this.cfg.repo && Date.now() - this.cfg.lastCheck > CHECK_EVERY) this.check();
    }, 30 * 60_000);
  }

  stop() {
    clearTimeout(this.startTimer);
    clearInterval(this.interval);
  }

  async check({ install = this.cfg.auto } = {}) {
    if (!this.cfg.repo) {
      this.set({ state: 'norepo', error: '' });
      return this.status();
    }
    if (this.st.state === 'checking' || this.st.state === 'downloading') return this.status();
    this.set({ state: 'checking', error: '' });
    try {
      const info = await updater.latestInfo(this.cfg.repo, this.d.fetch);
      this.cfg.lastCheck = Date.now();
      this.save();
      const ahead = updater.compareVersions(info.version, this.st.installed || this.d.version) > 0;
      const asset = this.d.installed ? updater.pickInstaller(info.assets, this.d.platform) : null;
      const macZip = this.d.installed && this.d.platform === 'darwin' ? updater.pickMacZip(info.assets) : null;
      this.set({
        latest: info.version,
        name: info.name,
        published: info.published,
        notes: info.notes,
        notesHtml: info.notesHtml,
        zip: info.zip,
        page: info.page,
        asset,
        macZip,
        // No installer for this system in that release: it's downloaded from the page.
        manual: !!this.d.installed && !asset,
        state: ahead ? 'available' : this.st.installed ? 'ready' : 'uptodate',
      });
      if (ahead && install && !this.d.devCopy && !this.st.manual) await this.install();
    } catch (e) {
      this.set({ state: 'error', error: String(e?.message || e) });
    }
    return this.status();
  }

  progress(p) {
    const now = Date.now();
    if (p < 1 && now - this.lastProgressAt < 150) return;
    this.lastProgressAt = now;
    this.set({ progress: p });
  }

  async install() {
    if (this.d.devCopy) return this.status();
    if (this.d.installed) return this.installInstaller();
    if (!this.st.zip) return this.status();
    this.set({ state: 'downloading', error: '', progress: null });
    try {
      const file = path.join(this.d.tempDir, `pear-drops-update-${Date.now()}.zip`);
      await updater.downloadTo(this.d.fetch, this.st.zip, file, (p) => this.progress(p));
      const files = updater.appFiles(updater.readZip(fs.readFileSync(file)));
      fs.rmSync(file, { force: true });
      // A brand-new release can still carry the previous version number for a minute
      // (until the release workflow stamps it): use the release's own version.
      if (files['package.json'] && this.st.latest) {
        try {
          const p = JSON.parse(files['package.json'].toString('utf8'));
          if (updater.compareVersions(this.st.latest, p.version) > 0) {
            p.version = this.st.latest;
            files['package.json'] = Buffer.from(`${JSON.stringify(p, null, 2)}\n`);
          }
        } catch {}
      }
      const backup = path.join(this.d.dataDir, 'update-backup', `${this.d.version}-${Date.now()}`);
      const res = updater.applyUpdate(this.d.appRoot, files, backup);
      this.set({ state: 'ready', installed: res.version, needsInstall: res.needsInstall, progress: 1 });
    } catch (e) {
      const m = String(e?.message || e);
      this.set({ state: 'error', error: /EACCES|EPERM/.test(m) ? 'nowrite' : m, progress: null });
    }
    return this.status();
  }

  /** Mac: can this copy replace itself? '' if so, otherwise why not. */
  async macSwapCheck() {
    const appPath = updater.macAppBundle(this.d.execPath);
    let writable = false;
    let req = '';
    try {
      fs.accessSync(path.dirname(appPath), fs.constants.W_OK);
      fs.accessSync(appPath, fs.constants.W_OK);
      writable = true;
    } catch {}
    if (appPath) req = updater.designatedReq(await this.d.runTool('codesign', ['-d', '-r-', appPath]).catch(() => ''));
    return { appPath, req, why: updater.macSwapBlocker({ app: appPath, writable, req }) };
  }

  async downloadMacApp() {
    const { appPath, req, why } = await this.macSwapCheck();
    if (why) throw new Error(`mac swap: ${why}`);
    const dir = fs.mkdtempSync(path.join(this.d.tempDir, 'pear-drops-update-'));
    try {
      const zip = await updater.downloadTo(this.d.fetch, this.st.macZip.url, path.join(dir, path.basename(this.st.macZip.name)), (p) => this.progress(p));
      const newApp = await updater.unpackMacApp(zip, path.join(dir, 'app'), req, this.d.runTool);
      fs.rmSync(zip, { force: true });
      return { appPath, newApp };
    } catch (e) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw e;
    }
  }

  async installInstaller() {
    if (this.st.manual || !this.st.asset) {
      this.d.openExternal(this.st.page || `https://github.com/${this.cfg.repo}/releases/latest`);
      return this.status();
    }
    this.set({ state: 'downloading', error: '', progress: null });
    if (this.st.macZip) {
      try {
        const swap = await this.downloadMacApp();
        this.set({ state: 'ready', installed: this.st.latest, installerFile: '', swap, blocked: false, needsInstall: false, progress: 1 });
        return this.status();
      } catch (e) {
        console.log(`Update: using the disk image instead (${e?.message || e})`);
      }
    }
    try {
      const dir = this.d.platform === 'darwin' ? this.d.downloadsDir : path.join(this.d.tempDir, 'pear-drops-update');
      const file = await updater.downloadTo(this.d.fetch, this.st.asset.url, path.join(dir, path.basename(this.st.asset.name)), (p) => this.progress(p));
      this.set({ state: 'ready', installed: this.st.latest, installerFile: file, swap: null, blocked: false, needsInstall: false, progress: 1 });
    } catch (e) {
      this.set({ state: 'error', error: String(e?.message || e), progress: null });
    }
    return this.status();
  }

  /** Hands over to the new version. -> what happened, for the page's message. */
  restart() {
    if (!this.d.installed) {
      if (this.st.needsInstall) return { needsInstall: true }; // the launcher reinstalls the engine first
      this.d.relaunch();
      return { ok: true };
    }
    const sw = this.st.swap;
    if (this.d.platform === 'darwin' && sw && fs.existsSync(sw.newApp)) {
      // macOS's App Management setting can refuse: then say where to allow it.
      let ok = false;
      try {
        ok = updater.canWriteInside(sw.appPath);
      } catch {}
      this.set({ blocked: !ok });
      if (!ok) return { blocked: true };
      const script = path.join(path.dirname(path.dirname(sw.newApp)), 'swap.sh');
      fs.writeFileSync(script, updater.macSwapScript());
      this.d.spawn('/bin/sh', [script, String(this.d.pid), sw.appPath, sw.newApp]);
      setTimeout(() => this.d.quit(), 300);
      return { ok: true };
    }
    const f = this.st.installerFile;
    if (!f || !fs.existsSync(f)) return { ok: false };
    if (this.d.platform === 'win32') {
      this.d.spawn(f, ['/S', '--force-run']); // silent install, then it starts the new version
      setTimeout(() => this.d.quit(), 300);
      return { ok: true };
    }
    this.d.openPath(f); // macOS disk image: drag Pear Drops into Applications
    return { ok: true, dmg: true };
  }

  /** Mac: skip the swap and use the disk image instead. */
  useDmg() {
    if (this.st.swap) fs.rmSync(path.dirname(path.dirname(this.st.swap.newApp)), { recursive: true, force: true });
    this.st = { ...this.st, macZip: null, swap: null, blocked: false };
    return this.installInstaller();
  }

  settings(patch = {}) {
    if (typeof patch.auto === 'boolean') this.cfg.auto = patch.auto;
    if (typeof patch.repo === 'string') {
      const r = patch.repo
        .trim()
        .replace(/^https?:\/\/github\.com\//i, '')
        .replace(/\/+$/, '')
        .replace(/\.git$/i, '');
      if (r === '' || updater.REPO_RE.test(r)) {
        this.cfg.repo = r;
        this.st = { ...this.st, state: 'idle', latest: null, error: '' };
      } else {
        this.set({ state: 'error', error: 'badrepo' });
        return this.status();
      }
    }
    this.save();
    this.emit('status', this.status());
    return this.status();
  }

  /** The "updated to x" note has been seen. */
  dismissJustUpdated() {
    this.justUpdated = null;
    this.emit('status', this.status());
  }
}

module.exports = { Updates, parseChangelog };
