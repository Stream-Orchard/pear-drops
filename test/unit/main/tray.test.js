const test = require('node:test');
const assert = require('node:assert/strict');
const { TrayController, WIDTH } = require('../../../src/main/tray');

/** A popover window that, like Windows with display scaling, reports itself a little bigger than it was set. */
function fakeWindow({ inflate = 3 } = {}) {
  const win = {
    bounds: { x: 0, y: 0, width: WIDTH, height: 520 },
    visible: false,
    calls: 0,
    isDestroyed: () => false,
    isVisible: () => win.visible,
    getSize: () => [win.bounds.width + inflate, win.bounds.height + inflate],
    setSize(width, height) {
      win.calls++;
      Object.assign(win.bounds, { width, height });
    },
    setBounds(b) {
      win.calls++;
      win.bounds = { ...b };
    },
  };
  return win;
}

/** A taskbar along the bottom of a 1920×1080 screen, with the tray icon near its right end. */
function setup(opts) {
  const handlers = {};
  const tray = new TrayController({
    onShowMain() {},
    onQuit() {},
    onAction() {},
    ipc: { handle: (name, fn) => (handlers[name] = fn) },
    screen: { getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }) },
  });
  const win = fakeWindow(opts);
  tray.popover = win;
  tray.tray = { getBounds: () => ({ x: 1800, y: 1044, width: 24, height: 32 }) };
  const resize = (height) => handlers['tray:resize'](null, height);
  return { tray, win, resize };
}

test('the open popover keeps its width however often its page reports its height (it once grew on Windows)', () => {
  const { win, resize } = setup();
  win.visible = true;
  for (let i = 0; i < 50; i++) resize(331.4);
  assert.equal(win.bounds.width, WIDTH);
  assert.equal(win.bounds.height, 331);
  assert.equal(win.calls, 1, 'the same height again leaves the window alone');
});

test('the popover follows its content height, within limits, and stays inside the work area above the taskbar', () => {
  const { win, resize } = setup();
  win.visible = true;
  resize(400);
  assert.deepEqual(win.bounds, { x: 1920 - WIDTH - 8, y: 1040 - 400 - 4, width: WIDTH, height: 400 });
  resize(5000);
  assert.equal(win.bounds.height, 720);
  resize(10);
  assert.equal(win.bounds.height, 200);
  resize(NaN);
  assert.equal(win.bounds.height, 200, 'not a height');
});

test('a hidden popover is resized in place and placed when it opens', () => {
  const { tray, win, resize } = setup();
  resize(300);
  assert.deepEqual(win.bounds, { x: 0, y: 0, width: WIDTH, height: 300 });
  tray.position();
  assert.deepEqual(win.bounds, { x: 1920 - WIDTH - 8, y: 1040 - 300 - 4, width: WIDTH, height: 300 });
});
