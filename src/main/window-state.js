'use strict';

const path = require('node:path');
const { app, screen } = require('electron');
const { readJson, writeJsonAtomic } = require('./config');

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;
const MIN_WIDTH = 480;
const MIN_HEIGHT = 360;
const SAVE_DELAY_MS = 400;

function statePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function isNum(n) {
  return Number.isFinite(n);
}

function intersects(a, b) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? { w, h } : null;
}

// A saved position is only reused if enough of the top edge (where the title bar
// is) lands on a connected monitor; otherwise a monitor was unplugged or rearranged
// and the window would open off-screen.
function positionIsVisible(bounds) {
  const titleStrip = { x: bounds.x, y: bounds.y, width: bounds.width, height: 32 };
  return screen.getAllDisplays().some((d) => {
    const hit = intersects(titleStrip, d.workArea);
    return hit && hit.w >= 120 && hit.h >= 16;
  });
}

function load() {
  const raw = readJson(statePath()) || {};
  const primary = screen.getPrimaryDisplay().workArea;
  const maxW = Math.max(...screen.getAllDisplays().map((d) => d.workArea.width));
  const maxH = Math.max(...screen.getAllDisplays().map((d) => d.workArea.height));

  const width = isNum(raw.width) ? Math.min(Math.max(raw.width, MIN_WIDTH), maxW) : Math.min(DEFAULT_WIDTH, primary.width);
  const height = isNum(raw.height) ? Math.min(Math.max(raw.height, MIN_HEIGHT), maxH) : Math.min(DEFAULT_HEIGHT, primary.height);
  const state = {
    width: Math.round(width),
    height: Math.round(height),
    isMaximized: raw.isMaximized === true,
    zoomLevel: isNum(raw.zoomLevel) ? Math.min(Math.max(raw.zoomLevel, -3), 5) : 0,
  };
  if (isNum(raw.x) && isNum(raw.y) && positionIsVisible({ x: raw.x, y: raw.y, width, height })) {
    state.x = Math.round(raw.x);
    state.y = Math.round(raw.y);
  }
  return state;
}

// Tracks the window and writes its geometry to disk. Only "normal" (not maximized,
// fullscreen or minimized) bounds are recorded, so un-maximizing after a restart
// returns to the size the user actually chose.
function track(win, initial) {
  const state = { ...initial };
  let timer = null;

  const capture = () => {
    if (win.isDestroyed()) return;
    // Fullscreen is deliberately not restored: relaunching into a fullscreen
    // window with no title bar is confusing. The size underneath it is kept.
    if (win.isFullScreen() || win.isMinimized()) return;
    state.isMaximized = win.isMaximized();
    if (!state.isMaximized) {
      const b = win.getBounds();
      Object.assign(state, { x: b.x, y: b.y, width: b.width, height: b.height });
    }
  };

  const save = () => {
    clearTimeout(timer);
    timer = null;
    capture();
    try {
      writeJsonAtomic(statePath(), state);
    } catch (err) {
      console.error('Could not save window state:', err.message);
    }
  };

  // Debounced so a drag-resize doesn't hammer the disk; capture is also deferred
  // because on Linux 'resize' can fire before isMaximized() has flipped.
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(save, SAVE_DELAY_MS);
  };

  for (const ev of ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
    win.on(ev, schedule);
  }
  win.on('close', save);

  return {
    save,
    setZoomLevel(level) {
      state.zoomLevel = level;
      schedule();
    },
  };
}

module.exports = { load, track, MIN_WIDTH, MIN_HEIGHT };
