<p align="center"><img src=".github/assets/hero.jpg" alt="Pear Drops: collects your Kick emote and badge drops with Kick's own player" width="100%"></p>

# Pear Drops

A desktop app that collects Kick **emote and badge drops** for you. Sign in once and it:
- finds a live stream that counts for each drop, with channels you follow first
- watches it with Kick's real player, muted at the window
- claims rewards the moment they unlock
- moves on to the next category when one is done

Game drops that need a linked game account are skipped unless you turn them on.

## Install

Download the installer for your computer from the [latest release](https://github.com/StreamOrchard/pear-drops/releases/latest), under **Assets**:

| Computer | File |
|---|---|
| **Windows** 10 or 11, 64-bit | `Pear-Drops-Setup-<version>.exe` |
| **Mac** (Apple silicon or Intel), macOS 13 or newer | `Pear-Drops-<version>-mac.dmg` |

The app is free, and it isn't signed with a paid Apple or Microsoft certificate yet, so your computer warns you the first time. That's expected:

**Windows**
1. Open the `.exe` you downloaded.
2. If a blue *Windows protected your PC* box appears, click **More info**, then **Run anyway**.
3. Follow the installer. Pear Drops opens when it's done, and gets a Start menu and desktop shortcut.

**Mac**
1. Open the `.dmg` and drag **Pear Drops** into **Applications**.
2. Open Pear Drops from Applications. macOS says it can't check it for malware: click **Done**.
3. Open **System Settings › Privacy & Security**, scroll down to *"Pear Drops" was blocked* and click **Open Anyway** (and again in the box that follows), then enter your password. You only do this once.
4. If macOS asks to use *Pear Drops Safe Storage* in your keychain (it can after an update), enter your password and click **Always Allow**. That key encrypts your saved Kick login.

**Then:**
1. Click **Sign in with Kick** and log in to Kick in the window that appears.
2. Close any other Kick streams on your account, in other tabs, apps or your phone. Kick credits drops to only one stream at a time (see *How Kick drops work* below).
3. That's it. Pear Drops picks a stream and starts collecting. Closing the window keeps it going in the menu bar (Mac) or the system tray (Windows).

Pear Drops updates itself: Settings › Updates shows when there's a new version.

## Features

- **Live dashboard:** the drop being farmed, a progress ring and ETAs, a credited-minutes chart with a forecast to each reward, a live monitor of watch events vs credits, and session stats. With nothing playing, the chart shows why: what resuming would bring, a radar over the drops still to go while it waits for a live channel, or the rewards collected once everything's done. Each check with Kick pulses through the dashboard. It fits a maximized window without scrolling.
- **Drop queue:** every active emote/badge campaign grouped by category, with live stream counts and a bar of minutes watched with each reward's icon where it unlocks. Drag to reorder, or switch categories off. Or let **Smart order** sort it: what runs out of time first, with drops that are rarely live caught while they're on (it learns how often each category has a stream over the past week; Settings › Farming sets how much that counts and how readily it switches).
- **Done:** finished drops, and missed ones that ended with rewards left, in their own tab. Each drop's details, your last known progress and its artwork are saved on this computer, so they stay after Kick removes them. A drop Kick lists again with a new end date goes back into the queue.
- **Recovers by itself:**
  - streams that end or raid: noticed within seconds (the player's video ending, Kick's own "stream stopped" and raid events, the player moving on), then it switches
  - a frozen picture: checked with Kick within seconds, then reloaded after a minute
  - stalled progress: reloads, then switches streams after a set time without credit (20 minutes by default)
  - offline, banned or crashed streams
  - streamers changing category
  - sleep and wake

  What's wrong shows at once: the LIVE chip turns Frozen, Buffering or Checking on the dashboard and in the tray, and a notice says what happened and where it went next.
- **Conflict alarm:** Kick credits **one stream per account**. If the player keeps sending watch events and none are credited, another Kick stream on your account (a multiview, another tab, the phone app) is taking the credit. The app chimes and shows a banner.
- **History:** a permanent local log of everything: credits, unlocks, claims, stalls, reloads, crashes, switches, conflicts and completions. It has an overview (daily activity, when you farm, efficiency, top channels), a per-drop view, a timeline, and watch-session and channel tables.
- **Menu bar / tray:** closing or minimizing keeps it farming. The tray icon is a progress ring, and its popover shows the current drop, ETAs and quick controls.
- **Stream and chat** dock beside the dashboard. You can collapse them, and stream sound is always muted at the window. Its header has a Follow / Following button (the same Kick calls as kick.com's own button); followed channels are watched first.
- **Updates from GitHub** (Settings › Updates): checks the project's latest release, with its notes and a What's new timeline. Installed copies download the new installer (on a Mac, the app swaps itself in on restart); copies run from source get the new files, keeping a backup. After an update, the app shows what changed once.
- **Connected apps** (Settings › Connected apps): links Pear Drops with [Stream Multiview](https://github.com/GlowingPear/stream-window-multiview) on the same computer, through [Grapevine](https://github.com/StreamOrchard/grapevine). Off until you switch it on in both apps. While you farm, multiview can sign its Kick players out so they don't take the drop credit, and show what you're farming. If its signed-in players do take the credit, the banner says so. Each app's card shows its logo, what it is, where to get it, what the two share and how the link is going. **Activity** on the card shows every message between the two since Pear Drops started, in plain words: the totals each way, the heartbeat, a chart of the last 30 minutes, and each message's fields.
- **Desktop notifications** (Settings › Notifications): pick which ones you want, all off to start with. They cover a drop claimed or ready to claim, a stream ending or raiding, stream problems, credit going to another stream, signing in again, everything collected or nothing live, and new drops on Kick. They can be limited to when Pear Drops isn't in front. "Send a test" checks your computer allows them, and a button opens its notification settings.
- **Font** (Settings › App): your computer's own font on macOS and Windows, or Inter, which comes with the app and looks the same everywhere. Linux uses Inter by default.

## Run from source

For Linux, or to work on the app. Needs [Node.js](https://nodejs.org) 24 or newer.

```sh
npm install
npm start          # switches on login encryption, then starts the app
```

Or double-click `start-mac-linux.sh` / `Start Pear Drops.bat`.

Then sign in as in *Install* above.

### Try it without an account

```sh
npm run demo       # stand-in Kick with made-up campaigns, channels and a week of history
```

## How Kick drops work (what the app relies on)

- Kick's web player sends a `tracking.user.watch.livestream` event over its WebSocket about every **2 minutes** while the video is playing. Each credited event adds 2 minutes to the campaign's progress.
- Kick credits only **one stream per account at a time**. Watching drops in this app while a multiview or another tab plays Kick on the same account will stall it.
- Muting doesn't matter to Kick. Here the window is muted and the player stays unmuted, because browsers throttle muted background video.

The app never sends watch events itself. It runs the real kick.com channel page, so the traffic matches a normal viewer's.

## Privacy and security

- Your Kick login is stored only in the app's own browser session on this computer. It is encrypted with your system keychain (macOS Keychain / Windows DPAPI) via Electron's cookie-encryption fuse (`scripts/harden.js`, run by `npm start`).
- The login token is read inside the kick.com page and never passes through the app's own code or IPC.
- *Settings › Forget my login when I quit* signs you out on every quit. If the app crashed, it does this at the next start instead.
- Everything the app keeps stays on your computer, in its data folder: settings in `settings.json`, the history, the drop archive and the startup cache in one database, `pear-drops.db`, and drop artwork in `drop-images/`. Versions up to 0.1.5 kept files instead (`history.jsonl`, `drops.json`, `cache.json`); the first start of a newer one copies them in and leaves them as they were.
- The database is backed up to `backups/` in the data folder every day (or week, or not at all: **Settings › Privacy & data**), keeping the last 3 copies (or 7 or 14), and before any update that changes how it's stored. If it's ever damaged, the app puts the newest good copy back by itself and says so in History.
- Connected apps talk only on this computer, through a private local socket (a named pipe on Windows), after you've switched the link on in both. The first time, Pear Drops asks before it pairs (**Allow** on the card), so another program can't pair as Stream Multiview by itself. Pear Drops tells them what it's farming, never your login. Pairing keys are kept in `grapevine.json`, encrypted with your system keychain.
- Kick's pages can't reach the app (`src/main/guard.js`): the app only answers messages from its own windows, a Kick page opens a link in your browser only just after you clicked in it, and only web addresses ever open (never another app's protocol). The sign-in window stays on Kick and its sign-in providers. No page gets the camera, microphone, screen or clipboard reading.
- Installed copies ignore the `PD_` settings that tests and developer copies use (a stand-in GitHub, demo mode, another data folder), refuse debugging switches such as `--remote-debugging-port`, and only run the app files they were built with (Electron's asar integrity fuses).

## Development

| Command | What it does |
|---|---|
| `npm run dev` | Dev copy with a throwaway data folder (`-- --profile <name>` keeps it, `-- --debug` opens a debug port) |
| `npm run demo` | Dev copy against the stand-in Kick |
| `npm test` | Unit tests (`test/unit/`, mirrors `src/`) |
| `npm run test:launch` | The real app in demo mode, hidden and muted (`test:launch:visible` to watch) |
| `npm run test:coverage` | Unit coverage, checked against `test/coverage-min.json` (minimums only go up: `-- --update`) |
| `npm run dist:mac` / `dist:win` | Installers in `dist/` |
| `npm run icon` | Renders `build/icon.svg` to the app and installer icons |

### Project structure

```
src/main/        Electron main process
  main.js        windows, IPC, sign-in, tray, demo wiring
  farmer.js      the engine: picks streams, tracks progress, recovers, claims, records history
  kick-api.js    Kick API calls, made from a hidden kick.com page
  watcher.js     the docked kick.com channel page (and offscreen mirror for captures)
  db.js          the database (Node's built-in SQLite): history, drop archive, startup cache, small state
  backups.js     its daily or weekly backups, and how many are kept
  history.js     permanent event log and its aggregations
  archive.js     saved copies of every drop seen (details, progress, images)
  updates.js     update checks, downloads and installs (updater.js: GitHub, zips, signatures)
  tray.js        menu bar / tray icon and popover
  notifier.js    desktop notifications: which kinds are on, repeats, Send a test
  connected.js   Settings › Connected apps: the Grapevine link with other apps, what Pear Drops tells them
  activity.js    the Activity log: every message each way this run, kept in memory
  security.js    login encryption migration, forget-on-quit, where links and pop-ups go
  guard.js       what the app lets in: who may send its messages, what pages may ask for, the PD_ settings
  demo.js        stand-in Kick for tests, demos and the trailer
src/preload/     bridges for the app pages and the channel page
src/renderer/    the dashboard, history and tray pages (plain JS, no build step)
test/unit/       node --test unit tests
test/launch/     Playwright launch tests against the real app
scripts/         dev, coverage, hardening, icon and release tools
build/           installer hooks and icon source
.github/assets/  the README's hero image (hero.jpg) and the repo's social preview (og.png), with the pages they're drawn from
```

The app's own pages never use system pop-ups such as `alert`, native message boxes or date pickers. `test/unit/no-system-popups.test.js` checks for them.

### Releases and updates

The app updates from the GitHub repository in `package.json`'s `updateRepo` (or the one entered in Settings › Updates). Until one is set, Settings › Updates says so and nothing is checked. When the repository moves (a rename), its old names go in `formerUpdateRepos`: installs that saved an old name follow to the new one. Releases already out reach the new name through GitHub's redirect from the old one.

Pull requests never change the version or `CHANGELOG.md`. Write their titles as one line a user would understand: they become the What's new entries.

Dependabot opens weekly pull requests for the npm packages and the GitHub Actions (`.github/dependabot.yml`). Patch and minor updates, and new major versions of Actions, merge themselves once the required checks pass (`.github/workflows/dependabot-automerge.yml`); other majors, and Grapevine past a patch, wait for review. Release notes leave them out (`.github/release.yml`).

**Publishing an update:**
1. **Releases → Draft a new release.** Tag it with the new version (e.g. `v0.2.0`, *Create new tag on publish*, target `main`).
2. **Generate release notes**, tidy them, and **Publish release**.

The **Build installers** workflow then sets the version from the tag and adds the notes to `CHANGELOG.md` (`scripts/prepare-release.js`), commits that to `main`, builds the installers and attaches them (Windows `.exe`; Mac `.dmg`, plus the `-mac.zip` the app uses to update itself). The commit needs a deploy key with write access in the secret `RELEASE_DEPLOY_KEY`; the workflow explains what's wrong if it's missing.

A Mac app only swaps itself in when the new build is signed with the same certificate (see below). Otherwise it downloads the disk image to drag in.

### Mac signing and the Keychain

The saved Kick login is encrypted with a key in the macOS Keychain. macOS only hands that key to "the same app" without asking, and it judges that in two ways:
- **The app's access list** ("Always Allow"): any stable certificate is enough.
- **The item's partition list**: this needs the certificate's **Apple Team ID**. Without one, macOS records each build's exact fingerprint (`cdhash`), so it asks for your password after every update.

Builds sign with the best identity on the Mac (`build/after-sign.js`):
1. a *Developer ID Application* certificate (paid Apple Developer account; with notarization, it also removes Gatekeeper's first-launch warning)
2. an *Apple Development* certificate (free: Xcode › Settings › Accounts › your Apple ID › Manage Certificates › +)
3. the self-signed "Pear Drops Local Signing" certificate (`npm run signing-cert`)
4. ad hoc

Only the first two stop the Keychain prompt after updates. Release builds should use a Developer ID: add it to the repository secrets `MAC_CERT_P12` and `MAC_CERT_PASSWORD`, and keep the same one from release to release.

## Notes and limitations

- Kick can change its site or API at any time. If drops stop progressing, check the History view's timeline for errors.
- Some campaigns require a specific channel. When none of those channels is live, the category waits ("Offline") and the app farms the next one.

## Disclaimer

Pear Drops isn't affiliated with or endorsed by Kick.

## License

Pear Drops is free software under the [GNU General Public License v3.0](LICENSE).
