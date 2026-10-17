---
name: release-video
description: Make the Pear Drops trailer, or a "what's new" video for a release - a feature-by-feature walkthrough of the real app in demo mode with animated title cards, captions, camera zooms, a spotlight, the menu bar popover, and a synthesized soundtrack with impacts and the app's own alert chime, as an MP4. Use when asked for a trailer, demo, walkthrough, showcase or release video.
---

# Trailer and release videos

A walkthrough of the real app, one feature at a time: a title card, then the feature in use with the same words as a caption. It runs against the stand-in Kick (`src/main/demo.js`), so no real streamer, chatter or account ever appears.

| File | What it does |
|---|---|
| `video.js` | Records a scenes file and makes the MP4: `node .claude/skills/release-video/video.js <scenes.js> [--out file.mp4] [--keep]` |
| `trailer.js` | The product trailer: sign in, stream picking, the player, forecast, claims, recovery, the conflict alarm, the queue, history and the menu bar. Use it as the model for new scenes files. |
| `capture.js` | Captures every frame the window paints, with real timing. Playwright's own video drops frames and looks laggy. |
| `music.js` | A synthesized soundtrack (no samples, nothing to license). 122 BPM in A minor, with intro, groove, chorus, a breakdown with a riser, a bigger chorus and an outro. It has side-chained pads and bass, reverb, arpeggios and a lead hook. Impacts land on every title card, and the app's alert chime plays where it rang, with the music ducking around it. |

## Tools

- Playwright: `npm run test:setup` once.
- ffmpeg with libx264 on the PATH: `brew install ffmpeg`, `winget install Gyan.FFmpeg` or `sudo apt install ffmpeg`.

Don't install anything without asking.

## How it records

- The app runs **hidden and muted** (it never takes focus) at 1440×900, rendered at 1.333×, so frames are 1920×1200. The docked stream is mirrored into the window (`PD_MIRROR_PLAYER`), so it's part of every frame.
- The soundtrack is made afterwards to the exact length. Card times become impacts and whooshes, and the times the alert chime played (captured from `playAlert`) become the real chime in the mix.
- Output is a 1920×1200 H.264 MP4 (CRF 18, AAC 192k) in the temp folder. Alongside it go a `thumbnail.png` (the poster) and a `sheet.png` contact sheet with a still every 4 s.

## Writing scenes

```js
module.exports = {
  name: 'pear-drops-0.2.0',
  steps: 4,                                  // progress dots on the cards
  signedIn: false,                           // start on the welcome screen
  poster: { kicker: 'New in 0.2', h: 'Pear *Drops*', p: 'One line about it' },
  async run(t) {
    await t.step('Title with *highlight*', 'One line of explanation');   // card, then the same words as a caption
    await t.zoom('#chart .chart-wrap', 1.6);  // camera onto something; t.unzoom() back out
    await t.ring('#hero .hero-rewards');      // spotlight; t.unring()
    await t.click('[data-action="side-tab"][data-id="streams"]');        // visible pointer glides and clicks
    await t.drag('.cat[data-cat-id] >> nth=3', '.cat[data-cat-id] >> nth=0');
    await t.demo((d) => d.credit());          // stand-in story: credit(), conflict(on), offline(slug), advance(campaign, units)
    await t.trayPopover(true);                // the menu bar and its popover, composited over the app
  },
};
```

## Style

- **Poster first.** The first frame is a still poster, never black. It's also `thumbnail.png`.
- **Each feature's card comes right before its demo.** Title cards are about 2.5 s; give each result 1–3 s; aim for 10–20 s per feature and 2–3 minutes overall.
- **Show it working:** real clicks and drags, the app's own alerts and toasts, and visible results.
- **Camera:** zoom in for detail (the forecast, the live monitor, the player) and back out before the next step.
- **Made-up everything.** Only the stand-in channels, chatters and history.

## Check it before handing it over

- Look at `sheet.png`. For details, grab stills: `ffmpeg -ss <s> -i <mp4> -frames:v 1 still.png`.
- Check:
  - Is every card before its demo?
  - Is every ringed or clicked thing in frame?
  - Do captions cover the thing being shown?
- The capture rate printed at the end should be about 24 fps or better, with the longest still under 0.4 s. If not, close heavy apps and record again.
