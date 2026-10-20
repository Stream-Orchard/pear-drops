# What's new in Pear Drops

Versions follow `major.minor.patch`. Each release's notes are written when it's published.

## 0.1.16 (current)
- On macOS the tray icon matches the menu bar (white or black) while quiet, and keeps its colour while farming, in trouble, or the daily reward waits

## 0.1.15
- The tray icon is the logo while no stream is live, and a hopping chest while the daily reward waits

## 0.1.14
- Daily reward: no dead-end Welcome Reward row, and no ring on the chest once claimed
- Drops limited to certain channels get queue rows of their own, named after the drop and pictured by its channels

## 0.1.13
- The daily reward chest's landing burst animates again
- The daily reward's crate opens properly when there's no video

## 0.1.12
- Kick's daily reward: a chest in the title bar and tray, claimed with Kick's reveal
- Connected apps: Stream Multiview can show Kick's daily reward chest, and the card lists what the apps share a line each

## 0.1.11
- The tray popover no longer grows wider and wider on Windows

## 0.1.10
- Updates come from the renamed StreamOrchard org, and older installs follow without a warning
- A quick restart keeps the exact time the stream started

## 0.1.9
- Notices: leaving a stream shows a proper notice instead of a broken toggle, and each kind has its own colour
- Activity log: clearer Kick player wording, a steady heartbeat, and why players sign back in minutes after farming stops
- Playwright comes with npm install, so the launch tests no longer need a separate setup step
- Security: Kick's pages can't open other apps or reach the app, Connected apps ask before pairing, and safer updates and releases

## 0.1.8
- Chart: a stream that just started draws cleanly, its label stays clear of the line, and the radar sits in the middle
- Chart: the radar is a full circle, and the past starts at the first reading

## 0.1.7
- History, drops and the startup cache are kept in one database: quicker to start as history grows, and nothing half-saved after a crash
- Back up your data every day or week, and put the newest good copy back if it's ever damaged
- Connected apps: an Activity log of every message between Pear Drops and the linked app
- Dashboard: with nothing playing, the chart shows why: what resuming would bring, a radar while it waits, or the rewards collected

## 0.1.6
- Done cards keep History and Details beside the drop, and missing artwork shows its placeholder
- Connected apps: link with Stream Multiview, so its Kick players leave the drop credit to Pear Drops
- Connected apps: a Test button, and start-change checks every release is recorded in Grapevine
- Grapevine's check runs as npm run grapevine:check, never npx
- README: how to install Pear Drops, step by step, before the features

## 0.1.5
- Rare says how many hours it has seen so far, and counts watch sessions from the history
- npm install no longer changes package-lock.json: releases keep its version in step
- A quick restart carries the run on: the stat cards keep counting, and Claimed really counts today

## 0.1.4
- Dashboard polish: clearer counts and labels, grouped activity, calmer switches, and no focus ring after a click
- The dashboard fills its space: a plan under the Queue, roomier rewards, and what's next while paused or waiting
- Small windows fit: every panel adapts, so nothing scrolls or is cut short on a 13" laptop
- After a restart nothing looks empty or contradictory: session sparkline, Activity from history, and a note on short Streams lists
- Coming soon replaces the plan: drops Kick has announced, with when they start
- Event drops find their channels through the event's own stream list
- Drops link to their About page, and a refused claim says why (with Link your account)

## 0.1.3
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
