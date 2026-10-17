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
  alertOnStall: true,
  repeatAlert: false, // keep chiming until stopped, or until credit returns
  alertRepeatSeconds: 30,
  prioritizeExpiring: true,
  queueMode: 'manual', // 'manual': the user's order · 'smart': soonest-expiring first
  minimizeToTray: true,
  trayPercent: true,
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
