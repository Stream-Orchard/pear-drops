// Runs a dev copy of the app with its own data folder, so it never touches your
// real login, settings or history.
//   npm run dev                      fresh, throwaway data folder (deleted on exit)
//   npm run dev -- --profile work    keep the data folder between runs
//   npm run demo                     stand-in Kick with made-up drops (no account needed)
//   npm run dev -- --debug [port]    open the main process for a debugger
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
};

const profile = value('profile');
const data = profile ? path.join(os.tmpdir(), 'pear-drops-profiles', profile) : fs.mkdtempSync(path.join(os.tmpdir(), 'pear-drops-dev-'));
fs.mkdirSync(data, { recursive: true });

let electron;
try {
  electron = require('electron');
} catch {
  console.error('Electron is not installed: run `npm install` first.');
  process.exit(1);
}
require('child_process').spawnSync(process.execPath, [path.join(__dirname, 'harden.js')], { stdio: 'inherit' });

const env = { ...process.env, PD_DEV_DATA: data };
if (flag('demo')) Object.assign(env, { PD_DEMO: '1', PD_DEMO_SEED: '1', PD_DEMO_SIGNED_IN: '1' });
const extra = flag('debug') ? [`--inspect=${value('debug') ?? 9229}`] : [];

console.log(`Pear Drops dev copy${flag('demo') ? ' (demo)' : ''} · data: ${data}`);
const child = spawn(electron, [...extra, ROOT], { stdio: 'inherit', env });
const cleanup = () => {
  if (!profile) fs.rmSync(data, { recursive: true, force: true });
};
child.on('exit', (code) => {
  cleanup();
  process.exit(code ?? 0);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
