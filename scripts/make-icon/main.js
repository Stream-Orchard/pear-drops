// Renders build/icon.svg to the PNGs the app and installers use.
//   npx electron scripts/make-icon
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = [
  [path.join(ROOT, 'build', 'icon.png'), 1024],
  [path.join(ROOT, 'src', 'renderer', 'assets', 'icon.png'), 256],
];

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(ROOT, 'build', 'icon.svg'), 'utf8');
  const win = new BrowserWindow({ show: false, width: 1024, height: 1024, transparent: true, frame: false, webPreferences: { offscreen: true } });
  await win.loadURL(`data:text/html,<style>html,body{margin:0;background:transparent}</style>${encodeURIComponent(svg)}`);
  await new Promise((r) => setTimeout(r, 300));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  for (const [file, size] of OUT) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, image.resize({ width: size, height: size, quality: 'best' }).toPNG());
    console.log(`${path.relative(ROOT, file)} (${size}px)`);
  }
  app.quit();
});
