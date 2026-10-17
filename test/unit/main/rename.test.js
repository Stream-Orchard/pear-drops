const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { carryOver, CARRIED } = require('../../../src/main/rename');

function folders() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kdf-rename-'));
  const oldDir = path.join(root, 'Kick Drops');
  const newDir = path.join(root, 'Pear Drops');
  fs.mkdirSync(path.join(oldDir, 'drop-images'), { recursive: true });
  fs.mkdirSync(path.join(oldDir, 'Partitions', 'kick'), { recursive: true });
  for (const f of ['settings.json', 'history.jsonl', 'drops.json', 'cache.json']) fs.writeFileSync(path.join(oldDir, f), `old ${f}`);
  fs.writeFileSync(path.join(oldDir, 'drop-images', 'a.png'), 'png');
  fs.writeFileSync(path.join(oldDir, 'Partitions', 'kick', 'Cookies'), 'encrypted under the old name');
  return { oldDir, newDir };
}

test('the old folder’s settings, history and saved drops are copied into the new one', () => {
  const { oldDir, newDir } = folders();
  assert.deepEqual(carryOver(oldDir, newDir).sort(), ['cache.json', 'drop-images', 'drops.json', 'history.jsonl', 'settings.json']);
  assert.equal(fs.readFileSync(path.join(newDir, 'history.jsonl'), 'utf8'), 'old history.jsonl');
  assert.equal(fs.readFileSync(path.join(newDir, 'drop-images', 'a.png'), 'utf8'), 'png');
  assert.equal(fs.existsSync(path.join(newDir, 'Partitions')), false, 'not the login, which the new name can’t decrypt');
  assert.ok(fs.existsSync(path.join(oldDir, 'history.jsonl')), 'the old folder is left as it was');
  assert.ok(CARRIED.includes('updates.json'));
});

test('nothing is copied over a folder already in use, from a missing folder, or onto itself', () => {
  const { oldDir, newDir } = folders();
  fs.mkdirSync(newDir, { recursive: true });
  fs.writeFileSync(path.join(newDir, 'history.jsonl'), 'new');
  assert.deepEqual(carryOver(oldDir, newDir), []);
  assert.equal(fs.readFileSync(path.join(newDir, 'history.jsonl'), 'utf8'), 'new');
  assert.deepEqual(carryOver(path.join(oldDir, 'nope'), path.join(oldDir, '..', 'x')), []);
  assert.deepEqual(carryOver(oldDir, oldDir), []);
});
