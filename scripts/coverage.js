// Runs the unit tests with coverage and checks each file against its minimum in
// test/coverage-min.json (minimums can only go up).
//   npm run test:coverage                 run and check
//   npm run test:coverage -- --update     raise the minimums to today's figures
// Below a minimum fails on CI (CI is set) and only warns locally.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'coverage');
const MIN_FILE = path.join(ROOT, 'test', 'coverage-min.json');
fs.mkdirSync(OUT, { recursive: true });
const lcov = path.join(OUT, 'lcov.info');

const run = spawnSync(
  process.execPath,
  ['--test', '--test-force-exit', '--experimental-test-coverage', '--test-coverage-include=src/**', '--test-reporter=spec', '--test-reporter-destination=stdout', '--test-reporter=lcov', `--test-reporter-destination=${lcov}`, 'test/unit/**/*.test.js'],
  { cwd: ROOT, stdio: 'inherit' },
);
if (run.status !== 0) process.exit(run.status ?? 1);

// lcov: SF:<file> ... LF:<lines found> LH:<lines hit> ... end_of_record
const files = {};
let current = null;
for (const line of fs.readFileSync(lcov, 'utf8').split('\n')) {
  if (line.startsWith('SF:')) {
    current = path.relative(ROOT, path.resolve(ROOT, line.slice(3))).split(path.sep).join('/');
    files[current] = { found: 0, hit: 0 };
  } else if (line.startsWith('LF:')) files[current].found = Number(line.slice(3));
  else if (line.startsWith('LH:')) files[current].hit = Number(line.slice(3));
}
const pct = Object.fromEntries(Object.entries(files).map(([f, { found, hit }]) => [f, found ? Math.floor((hit / found) * 1000) / 10 : 100]));

const mins = fs.existsSync(MIN_FILE) ? JSON.parse(fs.readFileSync(MIN_FILE, 'utf8')) : {};
const below = Object.entries(mins).filter(([f, min]) => (pct[f] ?? 0) < min);
const rows = Object.entries(pct)
  .sort()
  .map(([f, p]) => `| ${f} | ${p}% | ${mins[f] ?? '—'} |`);
const report = ['| File | Lines | Minimum |', '|---|---|---|', ...rows].join('\n');
fs.writeFileSync(path.join(OUT, 'report.md'), report + '\n');
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Coverage\n\n${report}\n`);
console.log(`\n${report}\n`);

if (process.argv.includes('--update')) {
  const next = { ...mins };
  for (const [f, p] of Object.entries(pct)) next[f] = Math.max(mins[f] ?? 0, Math.floor(p));
  fs.writeFileSync(MIN_FILE, JSON.stringify(Object.fromEntries(Object.entries(next).sort()), null, 2) + '\n');
  console.log(`Minimums updated in ${path.relative(ROOT, MIN_FILE)}`);
} else if (below.length) {
  const msg = below.map(([f, min]) => `  ${f}: ${pct[f] ?? 0}% < ${min}%`).join('\n');
  console.log(`Below the coverage minimum:\n${msg}`);
  if (process.env.CI) process.exit(1);
}
