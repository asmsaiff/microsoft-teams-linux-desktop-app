'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const ACTIONS = new Set(['minimize', 'maximize', 'close']);

contextBridge.exposeInMainWorld('titlebar', {
  action: (name) => {
    if (ACTIONS.has(name)) ipcRenderer.send('titlebar:action', name);
  },
  onState: (callback) => {
    ipcRenderer.on('titlebar:state', (_event, state) => callback(state));
  },
});
