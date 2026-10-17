---
name: run-dev
description: Run, restart or stop a developer copy of Pear Drops (npm run dev / npm run demo) with its own data folder, optionally against the stand-in Kick or with a debugging port. Use to try a change in the real app or before driving it with drive-app.
---

# Run a dev copy

```sh
npm run demo                                  # stand-in Kick: made-up drops, channels, a week of history
npm run dev                                   # real Kick, fresh data folder (deleted when it closes)
npm run dev -- --profile <name>               # real Kick, keeps the login and history between runs
npm run dev -- --debug [port]                 # also opens the main process for a debugger
```

`scripts/dev.js` runs `scripts/harden.js` first, like `npm start`. It also gives the copy its own data folder, so it never touches your real login, settings or history.

## Notes

- **Run it in the background** and read its output. Close the window or stop the process to quit. Never kill Electron processes by name: other apps use them too.
- **Picking up changes:** `src/main/` and `src/preload/` need a restart. `src/renderer/` only needs Cmd/Ctrl+R in the window.
- **Signing in to real Kick** in a dev copy opens Kick's own login window. On a Mac, the first start may ask for Keychain access to "Pear Drops Safe Storage" (login encryption): choose **Allow**.
- **Use the demo for anything recorded or shown.** Real profiles show a real account and real streamers.
- **One stream per account:** while a real profile farms, close other Kick tabs or multiviews on the same account, or credit will stall.
