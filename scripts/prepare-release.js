// Run by the release workflow when a release is published.
// Sets the app's version from the release tag and adds the release notes to CHANGELOG.md,
// so the installers (and the app's What's new in Settings › Updates) match the release.
//   node scripts/prepare-release.js v0.2.11 notes.md
// Pull requests never need to touch the version or the changelog.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const tag = String(process.argv[2] || '');
const version = tag.replace(/^v/i, '');
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`The release tag "${tag}" isn't a version like v0.2.11. Use a tag of that form.`);
  process.exit(1);
}
const notes = process.argv[3] && fs.existsSync(process.argv[3]) ? fs.readFileSync(process.argv[3], 'utf8') : '';

// 1. package.json version
const pkgFile = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
pkg.version = version;
fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');

// 2. Release notes -> What's new lines.
// GitHub's "Generate release notes" gives lines like
//   * Add the Done tab by @GlowingPear in https://github.com/owner/repo/pull/12
// which become "- Add the Done tab". "New Contributors" and "Full Changelog" are left out.
function toBullets(text) {
  const out = [];
  let skip = false;
  for (const raw of String(text).replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (/^#+\s/.test(line)) { skip = /new contributors/i.test(line); continue; }
    if (skip || !line || /^\*\*full changelog\*\*/i.test(line)) continue;
    const m = line.match(/^[-*]\s+(.*)$/);
    if (!m) continue;
    const item = m[1]
      .replace(/\s+by\s+@[\w-]+(\[bot\])?\s+in\s+https?:\/\/\S+$/i, '')
      .replace(/\s+in\s+https?:\/\/\S+$/i, '')
      .trim();
    if (item) out.push('- ' + item);
  }
  return out;
}
let bullets = toBullets(notes);
if (!bullets.length) {
  const plain = String(notes).replace(/\r/g, '').split('\n').map(s => s.trim()).filter(s => s && !/^#/.test(s));
  bullets = plain.length ? plain.map(s => '- ' + s.replace(/^[-*]\s+/, '')) : ['- Small fixes and improvements.'];
}

// 3. CHANGELOG.md: newest version at the top, marked "(current)".
const clFile = path.join(root, 'CHANGELOG.md');
let cl = fs.readFileSync(clFile, 'utf8');
const bom = cl.startsWith('﻿'), crlf = cl.includes('\r\n');
cl = cl.replace(/^﻿/, '').replace(/\r\n/g, '\n');
let lines = cl.split('\n').map(l => (/^##\s/.test(l) ? l.replace(/\s*\(current\)\s*$/i, '') : l));
const head = new RegExp(`^##\\s+v?${version.replace(/\./g, '\\.')}(\\s|$)`);
const at = lines.findIndex(l => head.test(l));
if (at >= 0) {
  lines[at] = lines[at].replace(/\s*$/, '') + ' (current)';     // already written by hand: keep it
} else {
  const first = lines.findIndex(l => /^##\s/.test(l));
  const block = [`## ${version} (current)`, ...bullets, ''];
  if (first >= 0) lines.splice(first, 0, ...block); else lines.push('', ...block);
}
let outText = lines.join('\n');
if (crlf) outText = outText.replace(/\n/g, '\r\n');
fs.writeFileSync(clFile, (bom ? '﻿' : '') + outText);

console.log(`Version ${version}; What's new:\n${(at >= 0 ? ['(kept the existing entry)'] : bullets).join('\n')}`);
