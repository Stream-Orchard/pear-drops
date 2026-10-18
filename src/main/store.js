const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  stallMinutes: 20,
  refreshSeconds: 60,
  campaignsMinutes: 10,
  streamsMinutes: 3,
  followedMinutes: 15,
  autoClaim: true,
  includeGameDrops: false,
  unmutePlayer: true,
  playerMode: 'light', // 'light': embed player + popout chat · 'full': the whole channel page
  showChat: true,
  playerQuality: 360, // full page only; null = Kick's automatic choice
  playerOpen: true,
  forgetOnQuit: false,
  backupEvery: 'day', // Settings › Privacy: how often the data is backed up (backups.js): 'day' | 'week' | 'off'
  backupKeep: 3, // how many backups to keep: 3 | 7 | 14
  alertOnStall: true,
  repeatAlert: false, // keep chiming until stopped, or until credit returns
  alertRepeatSeconds: 30,
  prioritizeExpiring: true,
  queueMode: 'manual', // 'manual': the user's order · 'smart': least expected live time left first
  smartRarity: 'strong', // Smart: how much a rarely live category counts as ending sooner ('off' | 'some' | 'strong')
  smartHopMinutes: 30, // Smart: how much sooner another drop must run out before leaving a working stream
  minimizeToTray: true,
  trayPercent: true,
  font: process.platform === 'linux' ? 'bundled' : 'system', // 'system': SF Pro, Segoe UI · 'bundled': Inter, the same everywhere
  // Settings › Notifications: a desktop notification switch per kind (src/main/notifier.js), all off to start with.
  // Settings › Connected apps: each app's Connect switch, off to start with (connected.js).
  connectedApps: { 'com.glowingpear.streammultiview': { enabled: false } },
  notify: { claimed: false, ready: false, ended: false, trouble: false, conflict: false, signedOut: false, done: false, newDrops: false },
  notifyAway: false, // only while Pear Drops isn't in front
  window: null, // { bounds, maximized }: remembered between launches
  categoryOrder: [],
  disabledCategories: [],
};

class Store {
  constructor(name = 'settings.json') {
    this.file = path.join(app.getPath('userData'), name);
    let saved = {};
    try {
      saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {}
    this.data = { ...DEFAULTS, ...saved };
  }

  get() {
    return this.data;
  }

  set(patch) {
    this.data = { ...this.data, ...patch };
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch (err) {
      console.error('Failed to save settings', err);
    }
    return this.data;
  }
}

module.exports = { Store, DEFAULTS };
