'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

// User-editable settings live in ~/.config/Teams/config.json. Anything missing
// falls back to these defaults, and unknown keys are ignored.
const DEFAULTS = Object.freeze({
  url: 'https://teams.microsoft.com/v2/',
  closeToTray: true,
  startHidden: false,
  titleBarHeight: 30,
  // Extra hostnames (and their subdomains) that may load inside the app, for
  // example a company's own single sign-on page: ["sso.example.com"].
  allowedDomains: [],
  spellcheckLanguages: ['en-US'],
  hardwareAcceleration: true,
});

let cached = null;

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// Write to a temp file and rename it into place so a crash or power loss mid-write
// never leaves a half-written, unparseable file behind.
function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function sanitize(raw) {
  const cfg = { ...DEFAULTS };
  if (!raw || typeof raw !== 'object') return cfg;

  if (typeof raw.url === 'string') {
    try {
      const u = new URL(raw.url);
      if (u.protocol === 'https:') cfg.url = u.toString();
    } catch { /* keep default */ }
  }
  for (const key of ['closeToTray', 'startHidden', 'hardwareAcceleration']) {
    if (typeof raw[key] === 'boolean') cfg[key] = raw[key];
  }
  if (Number.isInteger(raw.titleBarHeight) && raw.titleBarHeight >= 24 && raw.titleBarHeight <= 48) {
    cfg.titleBarHeight = raw.titleBarHeight;
  }
  if (Array.isArray(raw.allowedDomains)) {
    cfg.allowedDomains = raw.allowedDomains
      .filter((d) => typeof d === 'string')
      .map((d) => d.trim().toLowerCase().replace(/^\*?\./, ''))
      .filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d));
  }
  if (Array.isArray(raw.spellcheckLanguages)) {
    cfg.spellcheckLanguages = raw.spellcheckLanguages.filter((l) => typeof l === 'string');
  }
  return cfg;
}

function load() {
  if (cached) return cached;
  const file = configPath();
  const raw = readJson(file);
  cached = sanitize(raw);
  if (!raw) {
    try { writeJsonAtomic(file, cached); } catch { /* read-only home is fine */ }
  }
  return cached;
}

function addAllowedDomain(host) {
  const cfg = load();
  if (cfg.allowedDomains.includes(host)) return;
  cfg.allowedDomains = [...cfg.allowedDomains, host];
  const onDisk = readJson(configPath()) || {};
  onDisk.allowedDomains = cfg.allowedDomains;
  writeJsonAtomic(configPath(), onDisk);
}

module.exports = { load, addAllowedDomain, readJson, writeJsonAtomic };
