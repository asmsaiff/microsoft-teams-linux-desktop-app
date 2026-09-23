'use strict';

const { app, dialog, shell, BaseWindow } = require('electron');
const config = require('./config');

// Hosts (and all their subdomains) that may be loaded as a top-level page inside
// the app. Everything else is handed to the system browser. Sub-resources (scripts,
// images, CDN assets) and iframes are not affected by this list.
const MICROSOFT_DOMAINS = [
  'cloud.microsoft',
  'microsoft.com',
  'microsoft365.com',
  'microsoftonline.com',
  'microsoftonline-p.com',
  'microsoftstream.com',
  'live.com',
  'office.com',
  'office.net',
  'office365.com',
  'onmicrosoft.com',
  'sharepoint.com',
  'skype.com',
  'msauth.net',
  'msftauth.net',
  'msauthimages.net',
  'windows.net',
];

// Sign-in pages. A redirect from one of these to an unknown host is almost always
// a company's own single sign-on server, so the user is asked instead of the
// navigation being silently sent to the browser.
const LOGIN_HOSTS = ['login.microsoftonline.com', 'login.live.com', 'login.windows.net', 'login.microsoft.com'];

// Pages that open as in-app popup windows (meeting/chat pop-outs, auth popups).
const IN_APP_POPUP_HOSTS = ['teams.microsoft.com', 'teams.cloud.microsoft', 'teams.live.com', ...LOGIN_HOSTS];

const EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:', 'tel:', 'sip:', 'callto:']);

// Permissions Teams genuinely needs. Anything else (location, USB, MIDI, serial,
// HID, pointer lock...) is refused outright.
const GRANTED_PERMISSIONS = new Set([
  'media',
  'notifications',
  'fullscreen',
  'clipboard-sanitized-write',
  'speaker-selection',
  'screen-wake-lock',
  'idle-detection',
  'storage-access',
  'top-level-storage-access',
  'persistent-storage',
  'display-capture',
]);

// Hosts approved with "Allow once" live only until the app quits.
const sessionAllowedHosts = new Set();

function parse(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function hostMatches(host, domains) {
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

function isTrustedUrl(url) {
  const u = parse(url);
  if (!u || u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  return (
    hostMatches(host, MICROSOFT_DOMAINS) ||
    hostMatches(host, config.load().allowedDomains) ||
    sessionAllowedHosts.has(host)
  );
}

function isTrustedOrigin(origin) {
  return !!origin && isTrustedUrl(origin);
}

function openExternal(url) {
  const u = parse(url);
  if (!u || !EXTERNAL_PROTOCOLS.has(u.protocol)) return;
  shell.openExternal(u.toString()).catch(() => {});
}

// Asks the user whether a sign-in hop to an unknown host may continue in-app.
// Synchronous on purpose: navigation events must be decided before they return,
// and letting the original navigation through keeps any POSTed SAML form intact.
function askToAllowHost(contents, url) {
  const host = parse(url).hostname.toLowerCase();
  const owner = BaseWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible());
  const choice = dialog.showMessageBoxSync(owner, {
    type: 'question',
    title: 'Sign-in page',
    message: `Sign-in wants to continue at ${host}`,
    detail:
      'This is usually your organisation\'s own sign-in server. Only allow it if you recognise the address.\n\n' +
      url.slice(0, 300),
    buttons: ['Always allow', 'Allow once', 'Open in browser', 'Cancel'],
    defaultId: 3,
    cancelId: 3,
    noLink: true,
  });
  if (choice === 0) {
    sessionAllowedHosts.add(host);
    try { config.addAllowedDomain(host); } catch { /* still allowed for this session */ }
    return true;
  }
  if (choice === 1) {
    sessionAllowedHosts.add(host);
    return true;
  }
  if (choice === 2) openExternal(url);
  return false;
}

// Main-frame navigation guard for remote (Teams) web contents.
function guardNavigation(contents) {
  const handler = (event) => {
    if (!event.isMainFrame || isTrustedUrl(event.url)) return;
    const target = parse(event.url);
    const current = parse(contents.getURL());
    const fromLogin =
      current &&
      (LOGIN_HOSTS.includes(current.hostname) || hostMatches(current.hostname, config.load().allowedDomains));

    if (target && target.protocol === 'https:' && fromLogin && askToAllowHost(contents, event.url)) return;

    event.preventDefault();
    // Plain http and unknown protocols are never opened, even externally.
    if (target && target.protocol === 'https:' && !fromLogin) openExternal(event.url);
  };
  contents.on('will-navigate', handler);
  contents.on('will-redirect', handler);
}

function popupHandler(parentWindow) {
  return ({ url }) => {
    if (url === 'about:blank' || url === '') {
      return { action: 'allow', overrideBrowserWindowOptions: popupOptions(parentWindow) };
    }
    const u = parse(url);
    if (u && u.protocol === 'https:' && IN_APP_POPUP_HOSTS.includes(u.hostname) && isTrustedUrl(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: popupOptions(parentWindow) };
    }
    openExternal(url);
    return { action: 'deny' };
  };
}

function popupOptions(parentWindow) {
  const b = parentWindow && !parentWindow.isDestroyed() ? parentWindow.getBounds() : null;
  return {
    width: b ? Math.round(b.width * 0.7) : 1000,
    height: b ? Math.round(b.height * 0.8) : 700,
    autoHideMenuBar: true,
    backgroundColor: '#1f1f1f',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: true,
      devTools: isDev(),
    },
  };
}

function isDev() {
  return !app.isPackaged && process.argv.includes('--dev');
}

// Session-wide rules for the persistent Teams session.
function hardenSession(ses) {
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    const origin = details.requestingUrl || (contents && contents.getURL());
    if (!GRANTED_PERMISSIONS.has(permission) || !isTrustedOrigin(origin)) return callback(false);
    if (permission === 'media') {
      const types = details.mediaTypes || [];
      return callback(types.every((t) => t === 'audio' || t === 'video'));
    }
    callback(true);
  });

  ses.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
    const origin = (details && details.requestingUrl) || requestingOrigin;
    return GRANTED_PERMISSIONS.has(permission) && isTrustedOrigin(origin);
  });

  // No access to USB/HID/serial/Bluetooth devices at all.
  ses.setDevicePermissionHandler(() => false);
  ses.on('select-hid-device', (e, _d, cb) => { e.preventDefault(); cb(''); });
  ses.on('select-serial-port', (e, _p, _w, cb) => { e.preventDefault(); cb(''); });
  ses.on('select-usb-device', (e, _d, cb) => { e.preventDefault(); cb(); });

  // Refuse every unencrypted request made by the session. Teams is HTTPS-only.
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'ws://*/*'] }, (_details, cb) => cb({ cancel: true }));
}

// Applied to every web contents the app ever creates.
function installGlobalGuards() {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (e) => e.preventDefault());
  });
}

// Rules for any web contents showing remote Teams pages. Popups it opens get the
// same rules, recursively.
function hardenRemoteContents(contents, ownerWindow, onPopup) {
  guardNavigation(contents);
  contents.setWindowOpenHandler(popupHandler(ownerWindow));
  contents.on('did-create-window', (child) => {
    hardenRemoteContents(child.webContents, child, onPopup);
    if (onPopup) onPopup(child);
  });
}

// Local UI (title bar, picker) never navigates or opens windows.
function lockLocalContents(contents) {
  contents.on('will-navigate', (e) => e.preventDefault());
  contents.on('will-redirect', (e) => e.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

module.exports = {
  isTrustedUrl,
  isTrustedOrigin,
  openExternal,
  hardenRemoteContents,
  hardenSession,
  installGlobalGuards,
  lockLocalContents,
  isDev,
};
