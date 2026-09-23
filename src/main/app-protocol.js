'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { protocol } = require('electron');

// Local UI (title bar, screen picker) is served from app://local/ instead of
// file://, so it gets a real origin and no filesystem-wide access. The handler is
// registered on the default session only; the Teams session cannot reach it.
const SCHEME = 'app';
const HOST = 'local';
const ROOT = path.join(__dirname, '..');
const SERVED_DIRS = ['renderer', 'assets'];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
  "base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function registerScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true } }]);
}

function notFound() {
  return new Response('Not found', { status: 404 });
}

function handle() {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== HOST || request.method !== 'GET') return notFound();

    const file = path.join(ROOT, path.normalize(decodeURIComponent(url.pathname)));
    const inServedDir = SERVED_DIRS.some((d) => file.startsWith(path.join(ROOT, d) + path.sep));
    const type = TYPES[path.extname(file)];
    if (!inServedDir || !type) return notFound();

    try {
      const body = await fs.readFile(file);
      return new Response(body, {
        headers: {
          'content-type': type,
          'content-security-policy': CSP,
          'x-content-type-options': 'nosniff',
        },
      });
    } catch {
      return notFound();
    }
  });
}

const pageUrl = (name) => `${SCHEME}://${HOST}/renderer/${name}`;

module.exports = { registerScheme, handle, pageUrl };
