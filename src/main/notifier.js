// Desktop notifications: one switch per kind in Settings › Notifications, all off to start
// with, and optionally only while Pear Drops isn't in front. Repeats are dropped, and a click
// brings the app forward.

// The kinds, in the order Settings lists them.
const KINDS = ['claimed', 'ready', 'ended', 'trouble', 'conflict', 'signedOut', 'done', 'newDrops', 'dailyReady', 'dailyClaimed'];
const DEFAULT_NOTIFY = Object.fromEntries(KINDS.map((k) => [k, false]));
// The same notification again within this long isn't shown twice.
const REPEAT_MS = 10 * 60_000;
// Electron doesn't always say when a notification is closed (one left in the notification
// centre, or that just timed out), so only the latest ones are kept for their click handlers.
const KEEP = 30;

/** Settings › Notifications, cleaned: a switch for each kind (unknown ones dropped). */
function cleanNotify(value) {
  const v = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(KINDS.map((k) => [k, v[k] === true]));
}

class Notifier {
  /**
   * Notification: Electron's class. getSettings: the app's settings. inFront: whether one of
   * the app's windows has focus. onClick(view): bring the app forward. record: instead of
   * showing (demo mode and tests), called with each notification.
   */
  constructor({ Notification, getSettings, inFront = () => false, onClick = () => {}, icon, record = null, now = () => Date.now() }) {
    this.Notification = Notification;
    this.getSettings = getSettings;
    this.inFront = inFront;
    this.onClick = onClick;
    this.icon = icon;
    this.record = record;
    this.now = now;
    this.recent = new Map(); // "kind title body" -> when it was shown
    this.live = [];
  }

  /** Shows one, if its kind is switched on. Says what happened: 'shown', 'off', 'in-front', 'repeat' or 'unsupported'. */
  send(kind, { title, body = '', view = null }) {
    const settings = this.getSettings();
    if (!cleanNotify(settings.notify)[kind]) return 'off';
    if (settings.notifyAway && this.inFront()) return 'in-front';
    const key = `${kind} ${title} ${body}`;
    const t = this.now();
    if (t - (this.recent.get(key) ?? -Infinity) < REPEAT_MS) return 'repeat';
    this.recent.set(key, t);
    for (const [k, at] of this.recent) if (t - at >= REPEAT_MS) this.recent.delete(k);
    return this.show({ kind, title, body, view });
  }

  show({ kind, title, body, view }) {
    if (this.record) {
      this.record({ kind, title, body, view });
      return 'shown';
    }
    if (!this.Notification.isSupported()) return 'unsupported';
    const n = new this.Notification({ title, body: String(body).slice(0, 240), silent: true, ...(this.icon ? { icon: this.icon } : {}) });
    this.keep(n);
    n.on('click', () => this.onClick(view));
    n.show();
    return 'shown';
  }

  keep(n) {
    this.live.push(n);
    if (this.live.length > KEEP) this.live.shift();
    const drop = () => (this.live = this.live.filter((x) => x !== n));
    n.on('close', drop);
  }

  /**
   * Settings › Notifications › Send a test, whatever is switched on: 'shown', 'failed' (the
   * system refused it), 'sent' (no answer: macOS doesn't say when they're blocked) or
   * 'unsupported'.
   */
  test() {
    const note = { kind: 'test', title: 'Pear Drops', body: 'Desktop notifications work.' };
    if (this.record) {
      this.record(note);
      return Promise.resolve('sent');
    }
    if (!this.Notification.isSupported()) return Promise.resolve('unsupported');
    return new Promise((resolve) => {
      const n = new this.Notification({ title: note.title, body: note.body, silent: true, ...(this.icon ? { icon: this.icon } : {}) });
      this.keep(n);
      n.on('show', () => resolve('shown'));
      n.on('failed', () => resolve('failed'));
      n.on('click', () => this.onClick(null));
      setTimeout(() => resolve('sent'), 3000);
      n.show();
    });
  }
}

/** Where the system's notification settings are: System Settings on macOS, Settings on Windows. */
function systemSettingsUrl(platform = process.platform) {
  if (platform === 'darwin') return 'x-apple.systempreferences:com.apple.Notifications-Settings.extension';
  if (platform === 'win32') return 'ms-settings:notifications';
  return null;
}

module.exports = { Notifier, KINDS, DEFAULT_NOTIFY, cleanNotify, systemSettingsUrl, REPEAT_MS };
