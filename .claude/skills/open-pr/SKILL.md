---
name: open-pr
description: Open a pull request for a Pear Drops change - run the tests and coverage, write the description from the PR template with before/after captures from demo mode, show the draft for approval, then push and create it with gh. Use when a change is ready for review or the developer asks to open a PR.
---

# Open a pull request

## 1. Check the branch

It must not be `main`, and the commits must not change the version in `package.json` or `CHANGELOG.md`: releases do that.

## 2. Run the tests

- App code changed (`src/`, `scripts/`): run `npm run test:coverage`, then `npm run test:launch`. Launch tests are always hidden and muted, so the developer can keep working. Run them in the background with a time limit.
- Docs, skills or CI only: `npm test` is enough.
- **Coverage can't go down.** If a file drops below its minimum in `test/coverage-min.json`, add tests for the new code paths. If coverage went up, raise the minimums with `npm run test:coverage -- --update`.
- Report failures honestly in the PR: what was run, what wasn't, and the coverage of the files the change touched.

## 3. Write the draft

Follow `.github/pull_request_template.md`: plain words and short bullets.

- **Title:** one line a user would understand. Titles become "What's new" entries.
- **Before / after:** screenshots in a table, videos on their own line, or N/A. Only from demo mode: never a real account, streamer or chat.

Save the body in the temp folder, not the repo.

## 4. Show the draft and wait

Show the title, body and attachments. **Don't push until the developer approves.**

## 5. Push and create

```sh
git push -u origin <branch>
gh pr create --base main --title "<title>" --body-file <body.md> --attach <file> [--attach <file> ...]
```

An attachment the body doesn't mention is added at the end. To place one, such as in the Before / after table, reference it in the body with exactly the path given to `--attach` (run from the temp folder and use `./after.png` in both). `gh` then swaps that reference for the uploaded file's URL. Alt text goes after `#`, as in `--attach './after.png#The new tooltip'`.

Check that every attachment became a GitHub URL (`gh pr view --json body`). Use the developer's own git and gh accounts.

## 6. After merging

```sh
npm run worktree -- --clean
```
