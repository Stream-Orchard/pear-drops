// One branch, one worktree: .worktrees/<branch> inside the main checkout.
//   npm run worktree -- <branch> [--base <ref>]   new branch from origin/main (or <ref>), npm install
//   npm run worktree -- --clean                   remove worktrees whose branch is merged
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

if (args.includes('--clean')) {
  git('fetch', '--prune', 'origin');
  const merged = new Set(git('branch', '--merged', 'origin/main', '--format=%(refname:short)').split('\n').filter(Boolean));
  const list = git('worktree', 'list', '--porcelain').split('\n\n').filter(Boolean);
  for (const entry of list) {
    const dir = entry.match(/^worktree (.+)$/m)?.[1];
    const branch = entry.match(/^branch refs\/heads\/(.+)$/m)?.[1];
    if (!dir || !branch || branch === 'main' || !dir.includes(`${path.sep}.worktrees${path.sep}`)) continue;
    if (!merged.has(branch)) continue;
    if (git('-C', dir, 'status', '--porcelain')) {
      console.log(`Kept ${branch}: it has uncommitted changes`);
      continue;
    }
    git('worktree', 'remove', dir);
    git('branch', '-d', branch);
    console.log(`Removed ${branch}`);
  }
  process.exit(0);
}

const branch = args.find((a) => !a.startsWith('--'));
if (!branch) {
  console.error('Usage: npm run worktree -- <branch> [--base <ref>] | --clean');
  process.exit(1);
}
const baseIndex = args.indexOf('--base');
const base = baseIndex >= 0 ? args[baseIndex + 1] : 'origin/main';
const dir = path.join(ROOT, '.worktrees', branch.replace(/[\\/]/g, '-'));
if (fs.existsSync(dir)) {
  console.log(`Already exists: ${dir}`);
  process.exit(0);
}
git('fetch', 'origin');
git('worktree', 'add', '-b', branch, dir, base);
const install = spawnSync(npm, ['install', '--no-fund', '--no-audit'], { cwd: dir, stdio: 'inherit' });
if (install.status !== 0) process.exit(install.status ?? 1);
spawnSync(process.execPath, [path.join(dir, 'scripts', 'harden.js')], { cwd: dir, stdio: 'inherit' });
console.log(`\nWork in: ${dir}`);
