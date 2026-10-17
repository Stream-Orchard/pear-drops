---
name: platform-api-probe
description: Investigate Kick's drops, livestream, channel and follow APIs (and its watch-tracking WebSocket) with read-only requests from the app's own kick.com page. Use when drops stop progressing, claims fail, streams aren't found, or before changing code in src/main/kick-api.js.
---

# Probe Kick's API

Kick's web API is undocumented and changes without notice. Check what it returns today before changing `src/main/kick-api.js` or `src/main/farmer.js`.

## Rules

- **Read-only.** GET requests only. Never claim, follow, chat or change settings while probing. A claim is the one write the app makes; test it only in the app itself.
- Use the developer's own account, and only with their OK. Don't paste tokens, cookies or personal data anywhere: report status codes, field names and counts.
- Keep request counts low. Kick is behind Cloudflare.
- Kick credits one stream per account: probing on an account that is farming won't disturb credit, but playing streams will.

## How

1. Start a dev copy with a lasting profile: `npm run dev -- --profile <name>`, and sign in if needed.
2. From Playwright (see `drive-app`), or the dev copy's devtools, run requests through the engine's own API class, which works from the hidden kick.com page:

   ```js
   await app.evaluate(async () => {
     const { api } = global.pdDebug;           // set in dev copies (PD_DEV_DATA)
     const camps = await api.campaigns();       // web.kick.com/api/v1/drops/campaigns (public)
     const prog = await api.progress();         // web.kick.com/api/v1/drops/progress (signed in)
     return { active: camps.filter((c) => c.status === 'active').length, progress: prog.length };
   });
   ```
3. Endpoints the app uses:

   | What | Endpoint |
   |---|---|
   | Campaigns | `GET web.kick.com/api/v1/drops/campaigns` |
   | Your progress | `GET web.kick.com/api/v1/drops/progress` (units are minutes; rewards have `claimed`, `progress`) |
   | Claim | `POST web.kick.com/api/v1/drops/claim` `{ reward_id, campaign_id }` |
   | Eligibility of a stream | `GET web.kick.com/api/v1/drops/campaigns/livestream?channel_id=&category_id=` |
   | Live streams in a category | `GET web.kick.com/api/v1/livestreams?category_id=&sort=viewer_count_desc&limit=100&after=<cursor>` |
   | Channel status | `GET kick.com/api/v2/channels/<slug>/info` (`livestream.is_live`, `categories`) |
   | Followed channels | `GET kick.com/api/v2/channels/followed?cursor=` |
   | Account | `GET kick.com/api/v1/user` |

4. **Watch tracking:**
   - The page gets a token from `GET websockets.kick.com/viewer/v1/token`, then connects to `wss://websockets.kick.com/viewer/v1/connect`.
   - It sends `channel_handshake` every 15 s and `user_event` `tracking.user.watch.livestream` every `interval` seconds while the player is playing. The interval comes from `kick.com/api/internal/settings/global` and is currently 120.
   - `src/preload/watch.js` counts these sends. Check them in the History view's timeline and the dashboard's live monitor.

Write what you found (endpoints, fields, limits) in the PR's **Why** or **Tests**.
