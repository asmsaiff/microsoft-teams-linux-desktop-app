'use strict';

const titleEl = document.getElementById('title');
const badgeEl = document.getElementById('badge');
const maxIcon = document.getElementById('icon-max');
const restoreIcon = document.getElementById('icon-restore');
const maxButton = document.querySelector('[data-action="maximize"]');

for (const button of document.querySelectorAll('[data-action]')) {
  button.addEventListener('click', () => window.titlebar.action(button.dataset.action));
}

document.getElementById('bar').addEventListener('dblclick', (event) => {
  if (!event.target.closest('.controls')) window.titlebar.action('maximize');
});

window.titlebar.onState(({ title, maximized, focused, unread }) => {
  // Teams prefixes the page title with "(n)"; the badge shows it instead.
  const clean = String(title).replace(/^\(\d+\)\s*/, '');
  titleEl.textContent = clean;
  document.title = clean;
  badgeEl.hidden = !unread;
  badgeEl.textContent = unread > 99 ? '99+' : String(unread);
  // SVG elements have no .hidden property, so toggle a class instead.
  maxIcon.classList.toggle('off', maximized);
  restoreIcon.classList.toggle('off', !maximized);
  maxButton.title = maximized ? 'Restore' : 'Maximize';
  document.body.classList.toggle('blurred', !focused);
});
