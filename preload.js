const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openFolder:       ()           => ipcRenderer.invoke('open-folder'),
  readFolder:       (folderPath) => ipcRenderer.invoke('read-folder', folderPath),
  deleteFile:       (filePath)   => ipcRenderer.invoke('delete-file', filePath),
  getFileInfo:      (filePath)   => ipcRenderer.invoke('get-file-info', filePath),
  getPngMeta:       (filePath)   => ipcRenderer.invoke('get-png-meta', filePath),
  getLastFolder:    ()           => ipcRenderer.invoke('get-last-folder'),
  setWatchFolder:   (folderPath) => ipcRenderer.invoke('set-watch-folder', folderPath),
  onFolderChanged:  (cb)         => ipcRenderer.on('folder-changed', cb),
  offFolderChanged: (cb)         => ipcRenderer.removeListener('folder-changed', cb),
  toggleFullscreen:    ()    => ipcRenderer.invoke('toggle-fullscreen'),
  onFullscreenChanged: (cb)  => ipcRenderer.on('fullscreen-changed', (_, v) => cb(v)),
  offFullscreenChanged: (cb) => ipcRenderer.removeAllListeners('fullscreen-changed'),
  listCharacters: ()      => ipcRenderer.invoke('list-characters'),
  readCharacter:  (p)     => ipcRenderer.invoke('read-character', p),
  saveCharacter:  (data)  => ipcRenderer.invoke('save-character', data),
  listPresets:    ()      => ipcRenderer.invoke('list-presets'),
  readPreset:     (n)     => ipcRenderer.invoke('read-preset', n),
  savePreset:     (data)  => ipcRenderer.invoke('save-preset', data),
  deletePreset:   (n)     => ipcRenderer.invoke('delete-preset', n),
});
