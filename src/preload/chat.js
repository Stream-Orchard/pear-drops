// Preload for the docked popout chat (light panel mode). Chat doesn't affect drops;
// this keeps Kick's cookie banner and upsell prompts from covering it, and passes on Kick's
// realtime events about the stream itself (it stopped, a raid), which the player doesn't hear.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

// Same as the listener in src/preload/watch.js (preloads can't share files).
function pageHook() {
  if (window.__pdHooked) return;
  window.__pdHooked = true;
  const post = (msg) => window.postMessage({ __pd: true, ...msg }, location.origin);
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
    } catch {}
    return send.call(this, data);
  };
}
if (contextBridge.executeInMainWorld) contextBridge.executeInMainWorld({ func: pageHook });
else webFrame.executeJavaScript(`(${pageHook.toString()})()`);

window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.__pd !== true || event.data.kind !== 'realtime') return;
  ipcRenderer.send('watch:event', { kind: 'realtime', event: event.data.event, target: event.data.target });
});

const DECLINE = /^(not now|maybe later|no thanks|dismiss)$/i;

function tidy() {
  const reject = document.querySelector('#onetrust-reject-all-handler');
  if (reject && reject.offsetParent !== null) reject.click();
  for (const b of document.querySelectorAll('button')) {
    if (DECLINE.test(b.textContent.trim()) && b.offsetParent !== null) b.click();
  }
}

const timer = setInterval(tidy, 1500);
setTimeout(() => clearInterval(timer), 60_000);
