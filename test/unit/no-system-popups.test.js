// The app uses its own dialogs, menus and toasts: never the system's pop-ups
// (alert/confirm/prompt, native message boxes, date pickers, datalists).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..', 'src');
const PATTERNS = [
  [/(?<![\w.])(alert|confirm|prompt)\s*\(/, 'alert/confirm/prompt'],
  [/dialog\.(showMessageBox|showMessageBoxSync|showErrorBox)/, 'native message box'],
  [/\bMenu\.(buildFromTemplate|popup)|\.popup\(\{/, 'native menu'],
  [/<datalist|\blist=/, 'datalist'],
  [/type=["'](date|time|datetime-local|month|week)["']/, 'date picker'],
];

function strip(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function scan(code) {
  return PATTERNS.filter(([re]) => re.test(strip(code))).map(([, name]) => name);
}

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(path.join(dir, d.name)) : /\.(js|html)$/.test(d.name) ? [path.join(dir, d.name)] : []));
}

test('no system pop-ups anywhere in src/', () => {
  const found = files(SRC).flatMap((f) => scan(fs.readFileSync(f, 'utf8')).map((p) => `${path.relative(SRC, f)}: ${p}`));
  assert.deepEqual(found, []);
});

test('the scan catches each kind of pop-up', () => {
  assert.deepEqual(scan('alert("x")'), ['alert/confirm/prompt']);
  assert.deepEqual(scan('dialog.showMessageBox(w, {})'), ['native message box']);
  assert.deepEqual(scan('Menu.buildFromTemplate([])'), ['native menu']);
  assert.deepEqual(scan('<input list="x">'), ['datalist']);
  assert.deepEqual(scan('<input type="date">'), ['date picker']);
  assert.deepEqual(scan('// alert("in a comment")\nwindow.kdf.alert'), []);
});
