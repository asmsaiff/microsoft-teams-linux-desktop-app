'use strict';

const path = require('node:path');
const { BaseWindow, BrowserWindow, desktopCapturer, ipcMain } = require('electron');
const { isTrustedOrigin, lockLocalContents } = require('./security');
const { pageUrl } = require('./app-protocol');

const isWayland = () =>
  process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY;

let pending = null; // { picker, sources, respond }

// Only the picker's own page may talk to these IPC channels.
function fromPicker(event) {
  return pending && !pending.picker.isDestroyed() && event.sender === pending.picker.webContents;
}

ipcMain.handle('picker:sources', (event) => {
  if (!fromPicker(event)) return [];
  return pending.sources.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.id.startsWith('screen:') ? 'screen' : 'window',
    thumbnail: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL(),
  }));
});

ipcMain.on('picker:choose', (event, id) => {
  if (!fromPicker(event)) return;
  const source = typeof id === 'string' ? pending.sources.find((s) => s.id === id) : null;
  pending.respond(source);
  pending.picker.close();
});

function showPicker(parent, sources, respond) {
  const picker = new BrowserWindow({
    parent,
    modal: true,
    width: 760,
    height: 540,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'Share your screen',
    autoHideMenuBar: true,
    backgroundColor: '#1f1f1f',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'picker.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false,
      spellcheck: false,
    },
  });
  lockLocalContents(picker.webContents);
  pending = { picker, sources, respond };
  picker.on('closed', () => {
    pending.respond(null); // no-op if a choice was already made
    pending = null;
  });
  picker.once('ready-to-show', () => picker.show());
  picker.loadURL(pageUrl('picker.html'));
}

function install(ses, getParentWindow) {
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    let answered = false;
    const respond = (source) => {
      if (answered) return;
      answered = true;
      try {
        callback(source ? { video: source } : {});
      } catch { /* requesting frame already gone */ }
    };

    if (!request.videoRequested || !isTrustedOrigin(request.securityOrigin) || pending) return respond(null);

    try {
      if (isWayland()) {
        // On Wayland the desktop portal shows its own picker and returns only the
        // source the user chose.
        const [source] = await desktopCapturer.getSources({ types: ['screen', 'window'] });
        return respond(source || null);
      }
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: false,
      });
      const own = new Set(BaseWindow.getAllWindows().map((w) => w.getMediaSourceId()));
      const list = sources.filter((s) => !own.has(s.id));
      if (list.length === 0) return respond(null);
      showPicker(getParentWindow(), list, respond);
    } catch (err) {
      console.error('Screen share failed:', err.message);
      respond(null);
    }
  });
}

module.exports = { install };
