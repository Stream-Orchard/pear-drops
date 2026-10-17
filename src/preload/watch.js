// Preload for the docked Kick channel page. It only observes: it counts the watch
// events Kick's own client sends, reports player state, and nudges the player to
// keep playing. It never sends anything to Kick itself.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

function pageHook() {
  if (window.__pdHooked) return;
  window.__pdHooked = true;
  const post = (msg) => window.postMessage({ __pd: true, ...msg }, location.origin);
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    try {
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
  ipcRenderer.send('watch:event', { kind: event.data.kind, channelId: event.data.channelId });
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

setInterval(() => {
  declinePrompts();
  // Mature-content gate: Kick shows a "Start watching" button on some channels.
  const mature = document.querySelector('[data-testid="mature"]');
  if (mature) mature.click();

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
}, 5000);
