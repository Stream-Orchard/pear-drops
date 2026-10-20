// The pages' stylesheets share one document: two animations of the same name and the later one
// silently replaces the earlier (the chest's pixel burst once played the crate's glow).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', '..', 'src', 'renderer');

test('every @keyframes name in the pages’ stylesheets is used once', () => {
  const seen = new Map();
  for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.css'))) {
    for (const [, name] of fs.readFileSync(path.join(DIR, file), 'utf8').matchAll(/@keyframes\s+([\w-]+)/g)) {
      assert.ok(!seen.has(name), `@keyframes ${name} is in ${seen.get(name)} and ${file}`);
      seen.set(name, file);
    }
  }
  assert.ok(seen.size > 10);
});
