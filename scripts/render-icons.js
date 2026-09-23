'use strict';

// Rasterises src/assets/icon.svg to every PNG size the Linux packages, window
// and tray need. Runs inside Electron (`electron scripts/render-icons.js`) so it
// uses Chromium's SVG renderer and needs no image tools on the build machine.

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const SVG = fs.readFileSync(path.join(ROOT, 'src', 'assets', 'icon.svg'), 'utf8');
const ICON_DIR = path.join(ROOT, 'build', 'icons');
const ASSET_DIR = path.join(ROOT, 'src', 'assets');

const TARGETS = [
  ...[16, 24, 32, 48, 64, 128, 256, 512, 1024].map((s) => [s, path.join(ICON_DIR, `${s}x${s}.png`)]),
  [512, path.join(ASSET_DIR, 'icon.png')],
  [64, path.join(ASSET_DIR, 'tray.png')],
];

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true, sandbox: true } });
  await win.loadURL('data:text/html,<canvas></canvas>');
  const svgUrl = `data:image/svg+xml;base64,${Buffer.from(SVG).toString('base64')}`;

  fs.mkdirSync(ICON_DIR, { recursive: true });
  for (const [size, file] of TARGETS) {
    const dataUrl = await win.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const c = document.querySelector('canvas');
          c.width = c.height = ${size};
          const ctx = c.getContext('2d');
          ctx.clearRect(0, 0, ${size}, ${size});
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, ${size}, ${size});
          resolve(c.toDataURL('image/png'));
        };
        img.onerror = () => reject(new Error('SVG failed to load'));
        img.src = ${JSON.stringify(svgUrl)};
      })`);
    fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  }
  console.log(`Rendered ${TARGETS.length} icons from icon.svg`);
  app.quit();
}).catch((err) => {
  console.error(err);
  app.exit(1);
});
