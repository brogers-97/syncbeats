const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimize: () => ipcRenderer.send('minimize-window'),
  close: () => ipcRenderer.send('close-window'),
  toggleAlwaysOnTop: () => ipcRenderer.send('toggle-always-on-top'),
  onAlwaysOnTopChanged: (callback) => ipcRenderer.on('always-on-top-changed', (_event, isOnTop) => callback(isOnTop)),

  // Window size: 'landing' | 'full' | 'compact' | 'mini'
  setWindowMode: (mode) => ipcRenderer.send('set-window-mode', mode),

  // Dragging the mini icon (it needs clicks too, so it can't be a CSS drag region)
  dragStart: () => ipcRenderer.send('window-drag-start'),
  dragMove: (dx, dy) => ipcRenderer.send('window-drag-move', dx, dy),
  dragEnd: () => ipcRenderer.send('window-drag-end'),

  // yt-dlp (runs in main process)
  ytSearch: (query) => ipcRenderer.invoke('yt-search', query),
  ytStream: (videoId) => ipcRenderer.invoke('yt-stream', videoId),
});
