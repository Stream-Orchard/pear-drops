// Preload for the docked Kick channel page. It only observes: it counts the watch
// events Kick's own client sends, listens for Kick saying the stream stopped or is
// raiding, reports player state, and nudges the player to keep playing. It never sends
// anything to Kick itself.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

function pageHook() {
  if (window.__pdHooked) return;
  window.__pdHooked = true;
  const post = (msg) => window.postMessage({ __pd: true, ...msg }, location.origin);
  // Kick's realtime socket (the channel page's chat and events): pass on the few events about
  // the stream itself, never chat. Same as src/preload/chat.js.
  const heard = new WeakSet();
  const STREAM_EVENT = /Stop|End|Offline|Raid|Host|MoveTo|LivestreamUpdated|Categor|GamificationWatchTimeGoalReached|GamificationLevelUp/i;
  const listen = (socket) => {
    if (heard.has(socket) || !/platform\.kick\.com|pusher/.test(String(socket.url))) return;
    heard.add(socket);
    socket.addEventListener('message', (e) => {
      for (const line of String(e.data).split('\n')) {
        try {
          const m = JSON.parse(line);
          const event = m.push?.pub?.data?.event ?? m.event;
          if (typeof event !== 'string' || !STREAM_EVENT.test(event) || /Message|Poll|Pinned|Reward|Gift|Subscription/i.test(event)) continue;
          let data = m.push?.pub?.data?.data ?? m.data;
          if (typeof data === 'string') data = JSON.parse(data);
          const target = data?.hosted?.slug ?? data?.target?.slug ?? data?.slug;
          post({ kind: 'realtime', event, target: typeof target === 'string' ? target : undefined });
        } catch {}
      }
    });
  };
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    try {
      listen(this);
      if (typeof data === 'string' && String(this.url).includes('websockets.kick.com')) {
        if (data.includes('tracking.user.watch.livestream')) {
          const message = JSON.parse(data)?.data?.message ?? {};
          post({ kind: 'watch-event', channelId: message.channel_id });
        } else if (data.includes('channel_handshake')) {
          post({ kind: 'handshake' });
        }
      }
    } catch {}
    return send.call(this, data);
  };
}

// The full channel page reads its starting quality from session storage: set it
// before Kick's code runs (drops credit the same at any quality).
try {
  const quality = ipcRenderer.sendSync('watch:quality');
  if (quality && location.hostname === 'kick.com') sessionStorage.setItem('stream_quality', String(quality));
} catch {}

const hookSource = `(${pageHook.toString()})()`;
if (contextBridge.executeInMainWorld) {
  contextBridge.executeInMainWorld({ func: pageHook });
} else {
  webFrame.executeJavaScript(hookSource);
}

window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data?.__pd) return;
  const { kind, channelId, reason, event: name, target } = event.data;
  ipcRenderer.send('watch:event', { kind, channelId, reason, event: name, target });
});

let config = { unmutePlayer: true };
ipcRenderer.on('watch:config', (_event, value) => {
  config = { ...config, ...value };
});

let pausedSince = null;
let unmuted = false;

// Kick's cookie banner can end up underneath its own overlays, where it can't be
// clicked. Answer it once (Reject All) so it never blocks the player or chat.
function dismissConsent() {
  const reject = document.querySelector('#onetrust-reject-all-handler');
  if (reject && reject.offsetParent !== null) reject.click();
}
const consentTimer = setInterval(dismissConsent, 1000);
setTimeout(() => clearInterval(consentTimer), 30_000);

// Upsell sheets ("Try 1080p", app prompts) cover the chat: decline them.
const DECLINE = /^(not now|maybe later|no thanks|dismiss)$/i;
function declinePrompts() {
  for (const b of document.querySelectorAll('button')) {
    if (DECLINE.test(b.textContent.trim()) && b.offsetParent !== null) b.click();
  }
}

// The video's own events, reported straight away rather than at the next 5 s check: one that
// ended or failed is a sign the stream is over.
for (const type of ['ended', 'error']) {
  document.addEventListener(type, (e) => e.target instanceof HTMLVideoElement && ipcRenderer.send('watch:event', { kind: 'hint', reason: `video-${type}` }), true);
}
for (const type of ['waiting', 'playing', 'pause']) document.addEventListener(type, (e) => e.target instanceof HTMLVideoElement && report(), true);

setInterval(() => {
  declinePrompts();
  // Mature-content gate: Kick shows a "Start watching" button on some channels.
  const mature = document.querySelector('[data-testid="mature"]');
  if (mature) mature.click();
  report();
}, 5000);

/** Tells the app how the player's video is doing (and nudges a paused one to play). */
function report() {
  const video = [...document.querySelectorAll('video')].sort((a, b) => b.clientWidth - a.clientWidth)[0];
  if (!video) {
    ipcRenderer.send('watch:event', { kind: 'video', video: null });
    return;
  }

  if (video.paused && !video.ended) {
    pausedSince ??= Date.now();
    if (Date.now() - pausedSince > 8000) video.play().catch(() => {});
  } else {
    pausedSince = null;
  }

  // The window itself is muted by the app, so the player can stay unmuted. A muted
  // player is the thing browsers throttle or pause in the background.
  if (config.unmutePlayer && !unmuted && !video.paused && video.muted) {
    video.muted = false;
    if (video.volume === 0) video.volume = 0.5;
    unmuted = true;
  }

  ipcRenderer.send('watch:event', {
    kind: 'video',
    video: {
      paused: video.paused,
      muted: video.muted,
      readyState: video.readyState,
      currentTime: Math.round(video.currentTime * 10) / 10,
      width: video.videoWidth,
      height: video.videoHeight,
    },
  });
}
