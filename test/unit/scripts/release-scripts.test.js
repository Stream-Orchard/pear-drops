// The release script, prepare-release.js: the version and changelog from the release notes.
// Each test runs the real script on a copy of the project in a temporary folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..', '..');
const CHANGELOG = `# What's new in Pear Drops

Intro text.

## 0.2.10 (current)
- Installers.

## 0.2.9
- Done tab.
`;

function project({ changelog = CHANGELOG, version = '0.2.10', lock = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-rel-'));
  fs.mkdirSync(path.join(dir, 'scripts'));
  for (const f of ['prepare-release.js']) fs.copyFileSync(path.join(ROOT, 'scripts', f), path.join(dir, 'scripts', f));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'pear-drops', version }, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), changelog);
  if (lock) fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({ name: 'pear-drops', version, lockfileVersion: 3, packages: { '': { name: 'pear-drops', version }, 'node_modules/x': { version: '1.0.0' } } }, null, 2) + '\n');
  return dir;
}
function prepare(dir, tag, notes) {
  const nf = path.join(dir, 'notes.md');
  fs.writeFileSync(nf, notes ?? '');
  return spawnSync(process.execPath, [path.join(dir, 'scripts', 'prepare-release.js'), tag, nf], { encoding: 'utf8' });
}
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');

const GENERATED = `## What's Changed
* Use CHANGELOG.md instead of CHANGELOG.txt by @pearfarmer in https://github.com/pearfarmer/pear-drops/pull/2
* Add a test suite by @Tron in https://github.com/pearfarmer/pear-drops/pull/3
* Bump something by @dependabot[bot] in https://github.com/pearfarmer/pear-drops/pull/4

## New Contributors
* @Tron made their first contribution in https://github.com/pearfarmer/pear-drops/pull/3

**Full Changelog**: https://github.com/pearfarmer/pear-drops/compare/v0.2.10...v0.2.11
`;

test('prepare-release turns GitHub\'s generated notes into a new changelog section', () => {
  const dir = project();
  const r = prepare(dir, 'v0.2.11', GENERATED);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(read(dir, 'package.json')).version, '0.2.11');
  const cl = read(dir, 'CHANGELOG.md');
  assert.ok(cl.includes(`## 0.2.11 (current)
- Use CHANGELOG.md instead of CHANGELOG.txt
- Add a test suite
- Bump something

## 0.2.10
- Installers.`), cl);
  assert.ok(!/made their first contribution|Full Changelog|@Tron|https:/.test(cl), 'links, names and extra sections are left out');
  assert.equal((cl.match(/\(current\)/g) || []).length, 1, 'only the new version is marked current');
  assert.ok(cl.indexOf('Intro text.') < cl.indexOf('## 0.2.11'), 'the intro stays at the top');
});

test('prepare-release keeps a section that was already written by hand', () => {
  const dir = project({ changelog: CHANGELOG.replace('## 0.2.10 (current)', '## 0.2.11\n- Written by hand.\n\n## 0.2.10 (current)') });
  const r = prepare(dir, 'v0.2.11', GENERATED);
  assert.equal(r.status, 0, r.stderr);
  const cl = read(dir, 'CHANGELOG.md');
  assert.ok(cl.includes('## 0.2.11 (current)\n- Written by hand.'), cl);
  assert.ok(!cl.includes('Add a test suite'));
  assert.ok(cl.includes('## 0.2.10\n'));
});

test('prepare-release handles plain notes and empty notes', () => {
  let dir = project();
  prepare(dir, 'v0.2.11', 'Fixed the queue drag.\nFaster start.');
  assert.ok(read(dir, 'CHANGELOG.md').includes('## 0.2.11 (current)\n- Fixed the queue drag.\n- Faster start.\n'));
  dir = project();
  prepare(dir, 'v0.2.11', '');
  assert.ok(read(dir, 'CHANGELOG.md').includes('## 0.2.11 (current)\n- Small fixes and improvements.\n'));
});

test('prepare-release keeps Windows line endings and the byte-order mark', () => {
  const dir = project({ changelog: '﻿' + CHANGELOG.replace(/\n/g, '\r\n') });
  prepare(dir, 'v0.2.11', GENERATED);
  const cl = read(dir, 'CHANGELOG.md');
  assert.ok(cl.startsWith('﻿'));
  assert.ok(!/[^\r]\n/.test(cl), 'every line ends in CRLF');
});

test('prepare-release refuses a tag that is not a version', () => {
  for (const tag of ['latest', 'v1.2', 'release-0.2.11', '']) {
    const dir = project();
    const r = prepare(dir, tag, GENERATED);
    assert.notEqual(r.status, 0, tag);
    assert.equal(JSON.parse(read(dir, 'package.json')).version, '0.2.10', 'nothing was changed');
    assert.equal(read(dir, 'CHANGELOG.md'), CHANGELOG);
  }
});

test('the real changelog has exactly one current version, matching package.json', () => {
  const cl = read(ROOT, 'CHANGELOG.md');
  const current = [...cl.matchAll(/^##\s+v?(\d+\.\d+\.\d+).*\(current\)\s*$/gm)].map(m => m[1]);
  assert.deepEqual(current, [JSON.parse(read(ROOT, 'package.json')).version]);
});

test('prepare-release sets the version in package-lock.json too, leaving the rest alone', () => {
  const dir = project({ lock: true });
  const r = prepare(dir, 'v0.2.11', GENERATED);
  assert.equal(r.status, 0, r.stderr);
  const lock = JSON.parse(read(dir, 'package-lock.json'));
  assert.equal(lock.version, '0.2.11');
  assert.equal(lock.packages[''].version, '0.2.11');
  assert.equal(lock.packages['node_modules/x'].version, '1.0.0');
  assert.ok(read(dir, 'package-lock.json').endsWith('}\n'), 'written the way npm writes it');
});

test('the real package-lock.json has the same version as package.json, so npm install leaves it alone', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
});
