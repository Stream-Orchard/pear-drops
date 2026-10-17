# What's new in Pear Drops

Versions follow `major.minor.patch`. Each release's notes are written when it's published.

## 0.1.3 (current)
- History no longer counts an interrupted watch session as still going
- History shows a first day by the hour, and watch sessions show the stream title
- Images that won't load show a tidy placeholder, and every Streams category shows its name and count

## 0.1.2
- The forecast reaches a drop's finish however far out it is
- Streams that end, raid or freeze are noticed in seconds and shown at once
- Desktop notifications, with a switch for each kind and a way to check they work
- Updates show a download arrow while downloading, and a spinner while checking
- Every Settings tab fits without scrolling (only the changelog scrolls)

## 0.1.1
- A social preview image for the repo
- Fix a flaky startup cache test on Windows
- Reopening the tray popover no longer rings the Pause button
- Installs no longer leave a change in package-lock.json
- A stream ending no longer opens Kick's player in your browser

## 0.1.0
- First version: collects Kick emote and badge drops with Kick's own player and chat (muted at the window), claims each reward the moment it unlocks, and moves on between categories
- Drop queue: drag to reorder, or let Smart order sort it, watching what runs out of time first and catching rarely live drops while they're on (Settings › Farming sets how much that counts)
- Live dashboard with a forecast chart, live monitor, ETAs and session stats, sized to fit a maximized window
- Recovery from stalls, offline or crashed streams, raids, category changes and sleep, plus an alarm when another stream on your account takes the credit
- Done tab: finished and missed drops, saved with their artwork after Kick takes them down
- History: a permanent log with an overview, per-drop views, timeline, watch sessions and channels
- Follow or unfollow the channel you're watching, from the player's header
- Updates from GitHub, with each release's notes and a What's new timeline (Settings › Updates)
- Menu bar / tray mode with a progress ring icon and popover
- Your computer's own font, or the bundled Inter that looks the same everywhere (Settings › App › Font)
- Encrypted login storage, with an option to forget it on quit
