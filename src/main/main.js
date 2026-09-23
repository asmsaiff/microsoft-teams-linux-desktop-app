'use strict';

const path = require('node:path');
const {
  app,
  BaseWindow,
  WebContentsView,
  Menu,
  Tray,
  ipcMain,
  nativeImage,
  nativeTheme,
  session,
} = require('electron');

// Keep settings separate from any other "Teams" client on the machine.
app.setPath('userData', path.join(app.getPath('appData'), 'teams-desktop'));

const config = require('./config');
const windowState = require('./window-state');
const security = require('./security');
const screenShare = require('./screen-share');
const contextMenu = require('./context-menu');
const appProtocol = require('./app-protocol');

const ASSETS = path.join(__dirname, '..', 'assets');
const PRELOAD = path.join(__dirname, '..', 'preload');
const PARTITION = 'persist:teams';

// Present as plain desktop Chrome. Teams checks the browser, and the default
// Electron user agent also leaks the app name and Electron version.
const CHROME_MAJOR = process.versions.chrome.split('.')[0];
app.userAgentFallback =
  `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`;

// Remote debugging would let any local process drive the signed-in session and
// read its cookies, so a packaged build refuses to start with those switches.
const DEBUG_SWITCHES = ['remote-debugging-port', 'remote-debugging-pipe', 'remote-debugging-address', 'inspect', 'inspect-brk'];
if (app.isPackaged && DEBUG_SWITCHES.some((s) => app.commandLine.hasSwitch(s))) {
  console.error('Debugging switches are disabled in this build.');
  app.exit(1);
}

const cfg = config.load();
appProtocol.registerScheme();
if (!cfg.hardwareAcceleration) app.disableHardwareAcceleration();

let win = null;
let teamsView = null;
let titleView = null;
let tray = null;
let tracker = null;
let quitting = false;
let pendingMaximize = false;
let unread = 0;
let zoomLevel = 0;

const backgroundColor = () => (nativeTheme.shouldUseDarkColors ? '#1f1f1f' : '#f5f5f5');

// msteams:/l/meetup-join/... links (e.g. "Join" buttons in calendar invites) are
// mapped onto the web client. Only /l/ deep links are accepted.
function deepLinkFromArgv(argv) {
  const arg = argv.find((a) => typeof a === 'string' && a.toLowerCase().startsWith('msteams:'));
  if (!arg) return null;
  try {
    const u = new URL(arg);
    if (!u.pathname.startsWith('/l/')) return null;
    return new URL(u.pathname + u.search, 'https://teams.microsoft.com').toString();
  } catch {
    return null;
  }
}

let layoutTimer = null;

function layout() {
  if (!win || win.isDestroyed()) return;
  const [width, height] = win.getContentSize();
  const bar = win.isFullScreen() ? 0 : cfg.titleBarHeight;
  titleView.setBounds({ x: 0, y: 0, width, height: bar });
  teamsView.setBounds({ x: 0, y: bar, width, height: Math.max(0, height - bar) });
}

// On Linux, 'resize' can fire before the window reports its final size (notably
// on maximize/restore), which would leave the views sized for the previous
// state. Lay out now and again once the size has settled.
function scheduleLayout() {
  layout();
  clearTimeout(layoutTimer);
  layoutTimer = setTimeout(layout, 50);
}

function sendTitleState() {
  if (!titleView || titleView.webContents.isDestroyed()) return;
  titleView.webContents.send('titlebar:state', {
    title: teamsView.webContents.getTitle() || 'Microsoft Teams',
    maximized: win.isMaximized(),
    focused: win.isFocused(),
    unread,
  });
}

function showWindow() {
  if (!win || win.isDestroyed()) return;
  if (pendingMaximize) {
    pendingMaximize = false;
    win.maximize();
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function toggleFullScreen() {
  win.setFullScreen(!win.isFullScreen());
}

function changeZoom(delta) {
  zoomLevel = delta === 0 ? 0 : Math.min(5, Math.max(-3, zoomLevel + delta));
  teamsView.webContents.setZoomLevel(zoomLevel);
  tracker.setZoomLevel(zoomLevel);
}

function handleShortcuts(event, input) {
  if (input.type !== 'keyDown') return;
  const ctrl = input.control || input.meta;
  const key = input.key;
  let handled = true;

  if (ctrl && !input.alt && (key === '=' || key === '+')) changeZoom(0.5);
  else if (ctrl && !input.alt && key === '-') changeZoom(-0.5);
  else if (ctrl && !input.alt && key === '0') changeZoom(0);
  else if (key === 'F11') toggleFullScreen();
  else if (key === 'F5' || (ctrl && input.shift && key.toLowerCase() === 'r')) teamsView.webContents.reload();
  else if (ctrl && key.toLowerCase() === 'q') { quitting = true; app.quit(); }
  else if (security.isDev() && ctrl && input.shift && key.toLowerCase() === 'i') teamsView.webContents.toggleDevTools();
  else handled = false;

  if (handled) event.preventDefault();
}

function updateUnread(title) {
  const match = /^\((\d+)\)/.exec(title || '');
  const count = match ? Number(match[1]) : 0;
  if (count === unread) return;
  unread = count;
  app.setBadgeCount(count);
  if (tray) tray.setToolTip(count ? `Teams — ${count} unread` : 'Teams');
}

const secureWebPreferences = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInSubFrames: false,
  nodeIntegrationInWorker: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  webviewTag: false,
  navigateOnDragDrop: false,
  safeDialogs: true,
  devTools: security.isDev(),
  // Microsoft's sign-in pages list only Windows/macOS fonts with no generic
  // fallback, which renders as serif on Linux. Default to a sans face instead.
  defaultFontFamily: { standard: 'Arial' },
};

function createMainWindow(initialUrl) {
  const state = windowState.load();

  win = new BaseWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: windowState.MIN_WIDTH,
    minHeight: windowState.MIN_HEIGHT,
    frame: false, // square corners: no window-manager decoration at all
    show: false,
    title: 'Microsoft Teams',
    backgroundColor: backgroundColor(),
    icon: nativeImage.createFromPath(path.join(ASSETS, 'icon.png')),
  });

  teamsView = new WebContentsView({
    webPreferences: {
      ...secureWebPreferences,
      partition: PARTITION,
      spellcheck: true,
      preload: path.join(PRELOAD, 'teams.js'),
    },
  });
  teamsView.setBackgroundColor(backgroundColor());

  // Start the network work first: it dominates time-to-Teams.
  teamsView.webContents.loadURL(initialUrl);

  titleView = new WebContentsView({
    webPreferences: {
      ...secureWebPreferences,
      preload: path.join(PRELOAD, 'titlebar.js'),
      spellcheck: false,
    },
  });
  titleView.setBackgroundColor(backgroundColor());
  titleView.webContents.loadURL(appProtocol.pageUrl('titlebar.html'));
  security.lockLocalContents(titleView.webContents);

  win.contentView.addChildView(teamsView);
  win.contentView.addChildView(titleView);
  layout();

  tracker = windowState.track(win, state);

  const wc = teamsView.webContents;
  security.hardenRemoteContents(wc, win, (child) => {
    child.webContents.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && input.key === 'F11') { child.setFullScreen(!child.isFullScreen()); e.preventDefault(); }
    });
    contextMenu.attach(child.webContents, () => child);
  });
  contextMenu.attach(wc, () => win);
  wc.on('before-input-event', handleShortcuts);
  titleView.webContents.on('before-input-event', handleShortcuts);

  wc.on('page-title-updated', (_e, title) => {
    updateUnread(title);
    sendTitleState();
  });
  // Chromium keeps zoom per host, so re-apply it after sign-in hops between hosts.
  zoomLevel = state.zoomLevel;
  wc.on('did-navigate', () => wc.setZoomLevel(zoomLevel));
  wc.on('zoom-changed', (_e, direction) => changeZoom(direction === 'in' ? 0.5 : -0.5));
  wc.on('enter-html-full-screen', () => win.setFullScreen(true));
  wc.on('leave-html-full-screen', () => win.setFullScreen(false));

  // Recover automatically if the page's renderer crashes or is killed.
  wc.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return;
    console.error('Teams renderer gone:', details.reason);
    setTimeout(() => { if (!wc.isDestroyed()) wc.reload(); }, 1000);
  });

  titleView.webContents.on('did-finish-load', sendTitleState);

  for (const ev of ['resize', 'maximize', 'unmaximize', 'restore', 'show', 'enter-full-screen', 'leave-full-screen']) {
    win.on(ev, scheduleLayout);
  }
  for (const ev of ['maximize', 'unmaximize', 'focus', 'blur']) win.on(ev, sendTitleState);

  win.on('close', (e) => {
    if (!quitting && tray) {
      e.preventDefault();
      if (win.isFullScreen()) win.setFullScreen(false);
      win.hide();
    }
  });
  win.on('closed', () => {
    win = null;
  });

  if (cfg.startHidden && tray) {
    pendingMaximize = state.isMaximized;
  } else {
    if (state.isMaximized) win.maximize();
    win.show();
  }
}

// Only the title bar's own page may drive the window.
ipcMain.on('titlebar:action', (event, action) => {
  if (!win || !titleView || event.sender !== titleView.webContents) return;
  if (action === 'minimize') win.minimize();
  else if (action === 'maximize') (win.isMaximized() ? win.unmaximize() : win.maximize());
  else if (action === 'close') win.close();
});

function createTray() {
  if (!cfg.closeToTray) return;
  try {
    tray = new Tray(nativeImage.createFromPath(path.join(ASSETS, 'tray.png')));
  } catch (err) {
    console.error('Tray unavailable, closing will quit:', err.message);
    tray = null;
    return;
  }
  tray.setToolTip('Teams');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show Teams', click: showWindow },
      { label: 'Reload', click: () => teamsView && teamsView.webContents.reload() },
      { type: 'separator' },
      { label: 'Quit', click: () => { quitting = true; app.quit(); } },
    ]),
  );
  tray.on('click', showWindow);
}

function prepareSession() {
  const ses = session.fromPartition(PARTITION);
  security.hardenSession(ses);
  screenShare.install(ses, () => win);

  const langs = cfg.spellcheckLanguages.filter((l) => ses.availableSpellCheckerLanguages.includes(l));
  if (langs.length) ses.setSpellCheckerLanguages(langs);

  ses.on('will-download', (_e, item) => {
    item.setSaveDialogOptions({
      defaultPath: path.join(app.getPath('downloads'), path.basename(item.getFilename())),
    });
  });

  // Open sockets to the hosts every launch needs while the window is being built.
  for (const url of [cfg.url, 'https://login.microsoftonline.com', 'https://statics.teams.cdn.office.net']) {
    ses.preconnect({ url, numSockets: 2 });
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  security.installGlobalGuards();
  Menu.setApplicationMenu(null);

  app.on('second-instance', (_e, argv) => {
    const link = deepLinkFromArgv(argv);
    if (link && teamsView) teamsView.webContents.loadURL(link);
    showWindow();
  });

  app.whenReady().then(() => {
    appProtocol.handle();
    prepareSession();
    createTray();
    createMainWindow(deepLinkFromArgv(process.argv) || cfg.url);
  });

  app.on('before-quit', () => {
    quitting = true;
    if (tracker) tracker.save();
  });
  app.on('window-all-closed', () => app.quit());

  // Logging out of the desktop session sends SIGTERM; save the window size first.
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    process.on(sig, () => { quitting = true; app.quit(); });
  }
}
