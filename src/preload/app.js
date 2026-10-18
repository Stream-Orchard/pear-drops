const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pd', {
  getState: () => ipcRenderer.invoke('app:getState'),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('state', listener);
    return () => ipcRenderer.removeListener('state', listener);
  },
  onAlert: (callback) => {
    const listener = (_event, alert) => callback(alert);
    ipcRenderer.on('alert', listener);
    return () => ipcRenderer.removeListener('alert', listener);
  },
  onPlayerFrame: (callback) => {
    const listener = (_event, role, jpeg) => callback(role, jpeg);
    ipcRenderer.on('player:frame', listener);
    return () => ipcRenderer.removeListener('player:frame', listener);
  },
  tray: {
    showMain: () => ipcRenderer.invoke('tray:show-main'),
    quit: () => ipcRenderer.invoke('tray:quit'),
    resize: (height) => ipcRenderer.invoke('tray:resize', height),
    action: (name) => ipcRenderer.invoke('tray:action', name),
  },
  history: (opts) => ipcRenderer.invoke('history:view', opts),
  onHistoryChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('history:changed', listener);
    return () => ipcRenderer.removeListener('history:changed', listener);
  },
  login: () => ipcRenderer.invoke('auth:login'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  pause: (paused) => ipcRenderer.invoke('farm:pause', paused),
  refresh: () => ipcRenderer.invoke('farm:refresh'),
  skip: () => ipcRenderer.invoke('farm:skip'),
  reload: () => ipcRenderer.invoke('farm:reload'),
  watch: (slug, categoryId) => ipcRenderer.invoke('farm:watch', slug, categoryId),
  claim: (campaignId, rewardId) => ipcRenderer.invoke('farm:claim', campaignId, rewardId),
  follow: (slug, on) => ipcRenderer.invoke('farm:follow', slug, on),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  connected: {
    set: (id, on) => ipcRenderer.invoke('connected:set', id, on),
    disconnect: (id) => ipcRenderer.invoke('connected:disconnect', id),
    pairAgain: (id) => ipcRenderer.invoke('connected:pair-again', id),
    test: (id) => ipcRenderer.invoke('connected:test', id),
    icons: () => ipcRenderer.invoke('connected:icons'),
    activity: (id, opts) => ipcRenderer.invoke('connected:activity', id, opts),
    onActivity: (callback) => {
      const listener = () => callback();
      ipcRenderer.on('connected:activity', listener);
      return () => ipcRenderer.removeListener('connected:activity', listener);
    },
  },
  notifyTest: () => ipcRenderer.invoke('notify:test'),
  backups: {
    run: () => ipcRenderer.invoke('backups:run'),
    show: () => ipcRenderer.invoke('backups:show'),
  },
  notifySystemSettings: () => ipcRenderer.invoke('notify:system-settings'),
  onShowView: (callback) => {
    const listener = (_event, view) => callback(view);
    ipcRenderer.on('show-view', listener);
    return () => ipcRenderer.removeListener('show-view', listener);
  },
  setPlayerBounds: (rect) => ipcRenderer.invoke('player:bounds', rect),
  suspendPlayer: (value) => ipcRenderer.invoke('player:suspend', value),
  playerDevtools: () => ipcRenderer.invoke('player:devtools'),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  updates: {
    status: () => ipcRenderer.invoke('update:status'),
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    restart: () => ipcRenderer.invoke('update:restart'),
    settings: (patch) => ipcRenderer.invoke('update:settings', patch),
    useDmg: () => ipcRenderer.invoke('update:use-dmg'),
    openPage: () => ipcRenderer.invoke('update:open-page'),
    privacySettings: () => ipcRenderer.invoke('update:privacy-settings'),
    seen: () => ipcRenderer.invoke('update:seen'),
    changelog: () => ipcRenderer.invoke('update:changelog'),
    openLink: (url) => ipcRenderer.invoke('update:open-link', url),
    onStatus: (callback) => {
      const listener = (_event, status) => callback(status);
      ipcRenderer.on('update:status', listener);
      return () => ipcRenderer.removeListener('update:status', listener);
    },
  },
});
