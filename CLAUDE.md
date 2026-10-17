# Pear Drops

An Electron app that farms Kick emote and badge drops. `src/main/` is the Electron side, `src/preload/` the bridges, and `src/renderer/` the app's pages (plain scripts, no build step). `README.md` has the features, how Kick drops work, the commands and the project structure.

## Working on a change

- Use the skills in `.claude/skills/`: `start-change`, `run-dev`, `drive-app`, `open-pr`, `platform-api-probe`, `release-video`. Changes go on a branch and end as a pull request; never commit to `main`. Don't change the version or `CHANGELOG.md`.
- Tests:
  - `npm test` for unit tests (`test/unit/` mirrors `src/` file by file)
  - `npm run test:launch` for the real app in demo mode, always hidden and muted
  - `npm run test:coverage` checks per-file minimums in `test/coverage-min.json`; they can't go down

  Add tests next to similar ones for every new code path.
- Everything must work against the stand-in Kick (`src/main/demo.js`, `PD_DEMO=1`). Screenshots, videos and tests only ever show made-up channels, chatters and accounts.
- No system pop-ups in the app's pages: no `alert`/`confirm`/`prompt`, native message boxes or menus, `<datalist>`, or date pickers. `npm test` checks this.
- Developer tooling must work on Windows, macOS and Linux.

## How the app works

- Kick credits watch time from its own player's WebSocket `user_event` (`tracking.user.watch.livestream`, about every 120 s while playing). The app runs the real kick.com page in a docked view (`watcher.js`) and never sends these itself.
- Kick credits **one stream per account**. `farmer.js` counts uncredited watch events to detect another session taking the credit.
- All Kick API calls run inside a hidden kick.com page (`kick-api.js`). The login token is read there and never leaves it.
- The renderer updates the DOM by morphing it (`setHTML` in `format.js`), so ticking numbers don't rebuild images or shift the layout. Charts are drawn at measured sizes and kept out of the layout flow.
- Kick's campaign list keeps ended drops (`status: "expired"`) for a few months. `archive.js` saves every drop seen (details, progress and images, served to the pages as `pd-img://`), so the Done tab and History outlive Kick's copy.
- Every notable event goes to `history.js` (`history.jsonl` in the data folder). New features that change farming should record an event and show it in the History view.
