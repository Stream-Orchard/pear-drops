---
name: start-change
description: Start a change to Pear Drops (bug fix, feature, issue) - plan it, create its branch in a separate git worktree, capture "before" screenshots/video in demo mode, build and check it, then hand over to open-pr. Use when asked to fix, add or change something in this repo, or to work on an issue.
---

# Start a change

Every change goes on its own branch in its own worktree and ends as a pull request. Never commit to `main`.

## 0. Anything to record in Grapevine?

Run `npm run grapevine:check` (after `npm install`, or in the new worktree). Not `npx grapevine-check`: if the package isn't installed, `npx` would fetch whatever has that name from npm. It looks at every Pear Drops release tag, and at what each one shipped for Connected apps (`package.json`'s `grapevine` field), against Grapevine's record.

- **"Nothing to record" or "is recorded":** carry on.
- **It lists releases:**
  1. Tell the developer which releases, and that until they're recorded those capability versions could still be changed in place.
  2. Offer to record them first. That's Grapevine's `app-shipped` skill, in a Grapevine checkout (`../grapevine` next to this repo, or clone `StreamOrchard/grapevine`): run each `npm run released -- …` line it printed, then a pull request and a patch release there.
  3. Then carry on with the change here.

## 1. What's the change?

- If the request already describes it, or names an issue (`#12` or a URL), use that. For an issue: `gh issue view <n> --comments`.
- If nothing was given, ask once: "What's the change? A short description or an issue number/URL."

## 2. Plan (read-only, before changing code)

Read the relevant code (see *Project structure* in `README.md`), then show a short plan and wait for approval:

- **Why:** the problem in one or two lines, plus `Fixes #<n>` if there's an issue
- **Changes:** which files, and how
- **Testing:**
  - which of `npm test` and `npm run test:launch` (always hidden and muted) to run
  - which new tests to add
  - what to try in the app (`npm run demo`)
- **History:** if the change affects farming, which event `history.js` should record, and how the History view shows it
- **Before / after:**
  - screenshot for a state you can see at one moment
  - video for something over time (progress, drag and drop, stalls and recovery)
  - N/A for refactors, CI and docs
- **Branch:** e.g. `fix/12-claim-retry` or `feat/history-export`. Pick it yourself.

## 3. Create the worktree

```sh
npm run worktree -- --clean      # removes worktrees whose branch is merged
npm run worktree -- <branch>
```

Work only in the printed folder from now on.

## 4. Capture "before"

Follow `drive-app`. It uses demo mode (stand-in Kick, made-up channels), so captures never show a real account or streamer. Save captures in the temp folder, never in the repo.

## 5. Build and check

- Match the surrounding style.
- No system pop-ups (`alert`, `confirm`, native message boxes or menus, `<datalist>`, date pickers). `npm test` checks this.
- Keep the dashboard fitting a maximized window without page scrolling. Ticking values must not shift the layout or rebuild images: `test/launch/farming.test.js` checks this.
- Add tests next to similar ones for every new code path. Coverage minimums can't go down.
- Try it in the real app (`run-dev`). Main-process changes need a restart; pages need Cmd/Ctrl+R.
- Capture "after" with the same steps as "before".
- Commit in small, clear commits. Don't change the version or `CHANGELOG.md`.

## 6. Hand over

When the developer is happy, follow `open-pr`.
