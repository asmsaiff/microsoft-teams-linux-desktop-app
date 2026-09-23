'use strict';

const { Menu, clipboard } = require('electron');
const { openExternal, isDev } = require('./security');

function isWebLink(url) {
  return /^https?:\/\//i.test(url || '');
}

// Electron ships no right-click menu, so provide the usual edit/link/spelling one.
function attach(contents, getWindow) {
  contents.on('context-menu', (_event, params) => {
    const items = [];
    const { editFlags } = params;

    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        items.push({ label: suggestion, click: () => contents.replaceMisspelling(suggestion) });
      }
      items.push({
        label: 'Add to dictionary',
        click: () => contents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      });
      items.push({ type: 'separator' });
    }

    if (isWebLink(params.linkURL)) {
      items.push({ label: 'Open link in browser', click: () => openExternal(params.linkURL) });
      items.push({ label: 'Copy link', click: () => clipboard.writeText(params.linkURL) });
      items.push({ type: 'separator' });
    }

    if (params.mediaType === 'image' && params.hasImageContents) {
      items.push({ label: 'Copy image', click: () => contents.copyImageAt(params.x, params.y) });
      items.push({ type: 'separator' });
    }

    if (params.isEditable) {
      items.push(
        { label: 'Undo', role: 'undo', enabled: editFlags.canUndo },
        { label: 'Redo', role: 'redo', enabled: editFlags.canRedo },
        { type: 'separator' },
        { label: 'Cut', role: 'cut', enabled: editFlags.canCut },
        { label: 'Copy', role: 'copy', enabled: editFlags.canCopy },
        { label: 'Paste', role: 'paste', enabled: editFlags.canPaste },
        { label: 'Paste as plain text', role: 'pasteAndMatchStyle', enabled: editFlags.canPaste },
        { type: 'separator' },
        { label: 'Select all', role: 'selectAll', enabled: editFlags.canSelectAll },
      );
    } else if (params.selectionText.trim()) {
      items.push({ label: 'Copy', role: 'copy' });
    }

    if (isDev()) {
      items.push({ type: 'separator' }, { label: 'Inspect element', click: () => contents.inspectElement(params.x, params.y) });
    }

    while (items.length && items[items.length - 1].type === 'separator') items.pop();
    if (items.length) Menu.buildFromTemplate(items).popup({ window: getWindow() });
  });
}

module.exports = { attach };
