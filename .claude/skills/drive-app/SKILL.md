---
name: drive-app
description: Drive the real Pear Drops app with Playwright in demo mode - screenshots, videos, clicking through the dashboard, history and tray, triggering credits, conflicts and offline streams - for before/after captures or checking a change. Use when you need to see or record the app.
---

# Drive the app

`drive.js` (next to this file) starts the real app against the stand-in Kick, with made-up campaigns, channels, chat and a week of history, in its own temporary data folder.

```js
const drive = require('./.claude/skills/drive-app/drive');
const a = await drive.launch({ size: [1512, 944] });      // hidden and muted unless { visible: true }
await a.shot('dashboard');                                // PNG in drive.outDir()
await a.demo((d) => d.credit());                          // one credited watch event
await a.demo((d) => d.conflict(true));                    // another session "takes" the credit
await a.demo((d, slug) => d.offline(slug), 'arcadia');    // the stream goes offline
await a.win.click('[data-action="view"][data-id="history"]');
await a.close();
```

- `a.win` is the main window, a Playwright page. Selectors: `src/renderer/*.js` and `test/launch/*.test.js`.
- The docked stream is a separate view, so it isn't in a page screenshot. Launch with `{ mirror: true }` to draw it into the window (as the trailer does).
- **Video:** `await a.record('name', async () => { … })` captures every painted frame and writes an MP4 with ffmpeg (`brew install ffmpeg`, `winget install Gyan.FFmpeg` or `apt install ffmpeg`).
- **Sizes:** check the dashboard at 1280×800, 1512×944 and the screen's full size. It should fit without page scrolling from about 1440×900 up.

## Tools

Install Playwright once with `npm run test:setup`. Don't install anything else without asking.

## Don't get stuck

Run long drives in the background with a time limit. If a step times out, take `a.shot('fail')` and read `a.errors` before retrying. Don't rerun blindly.
