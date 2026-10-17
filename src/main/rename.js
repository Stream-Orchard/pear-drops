// The app was called Kick Drops, and its data folder was named after it. On the first
// start as Pear Drops, the settings, history and saved drops are copied over once.
// The Kick login can't come along: it's encrypted with a key the system keychain
// keeps under the old name, so you sign in once more.
const fs = require('fs');
const path = require('path');

const OLD_NAME = 'Kick Drops';
const CARRIED = ['settings.json', 'history.jsonl', 'drops.json', 'drop-images', 'cache.json', 'updates.json'];

/** Copies the old folder's files into an unused new one. -> the names copied */
function carryOver(oldDir, newDir) {
  if (path.resolve(oldDir) === path.resolve(newDir) || !fs.existsSync(oldDir)) return [];
  // Only into a folder this app hasn't used yet.
  if (['settings.json', 'history.jsonl'].some((f) => fs.existsSync(path.join(newDir, f)))) return [];
  fs.mkdirSync(newDir, { recursive: true });
  const copied = [];
  for (const name of CARRIED) {
    const from = path.join(oldDir, name);
    if (!fs.existsSync(from)) continue;
    try {
      fs.cpSync(from, path.join(newDir, name), { recursive: true });
      copied.push(name);
    } catch {}
  }
  return copied;
}

module.exports = { OLD_NAME, CARRIED, carryOver };
