'use strict';

const grid = document.getElementById('grid');
const shareButton = document.getElementById('share');
let sources = [];
let kind = 'screen';
let selected = null;

function render() {
  grid.replaceChildren();
  const visible = sources.filter((s) => s.kind === kind);
  if (!visible.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = kind === 'screen' ? 'No screens found.' : 'No windows found.';
    grid.append(p);
  }
  for (const source of visible) {
    const card = document.createElement('button');
    card.className = 'source';
    card.setAttribute('role', 'option');
    card.setAttribute('aria-selected', String(source.id === selected));
    const img = document.createElement('img');
    img.alt = '';
    if (source.thumbnail.startsWith('data:image/')) img.src = source.thumbnail;
    const label = document.createElement('span');
    label.textContent = source.name; // textContent: window titles are untrusted
    card.append(img, label);
    card.addEventListener('click', () => { selected = source.id; shareButton.disabled = false; render(); });
    card.addEventListener('dblclick', () => window.picker.choose(source.id));
    grid.append(card);
  }
}

for (const tab of document.querySelectorAll('[data-kind]')) {
  tab.addEventListener('click', () => {
    kind = tab.dataset.kind;
    for (const t of document.querySelectorAll('[data-kind]')) t.setAttribute('aria-selected', String(t === tab));
    render();
  });
}

shareButton.addEventListener('click', () => selected && window.picker.choose(selected));
document.getElementById('cancel').addEventListener('click', () => window.picker.choose(null));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.picker.choose(null);
  if (e.key === 'Enter' && selected) window.picker.choose(selected);
});

window.picker.sources().then((list) => {
  sources = list;
  if (!sources.some((s) => s.kind === 'screen')) kind = 'window';
  for (const t of document.querySelectorAll('[data-kind]')) t.setAttribute('aria-selected', String(t.dataset.kind === kind));
  const firstScreen = sources.find((s) => s.kind === kind);
  selected = firstScreen ? firstScreen.id : null;
  shareButton.disabled = !selected;
  render();
});
