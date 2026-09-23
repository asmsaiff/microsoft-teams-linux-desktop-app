'use strict';

// Teams marks parts of its page (such as the full-window loading splash) with
// `-webkit-app-region: drag`, meant for Microsoft's own frameless desktop shell.
// In this frameless window Chromium honours that, so the page becomes a window
// drag handle that swallows every mouse click, and the region can outlive the
// page that set it. A user-origin !important rule outranks any page style, so the
// page can never claim a drag region. Nothing is exposed to the page.
const { webFrame } = require('electron');

webFrame.insertCSS(
  '*, *::before, *::after { -webkit-app-region: no-drag !important; app-region: no-drag !important; }',
  { cssOrigin: 'user' },
);
