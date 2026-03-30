const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vaultAPI', {
    unlock: (password) => ipcRenderer.invoke('vault-unlock', password),
    saveFile: (path) => ipcRenderer.invoke('save-file', path),
    readFile: (id) => ipcRenderer.invoke('read-file', id),
    selectFiles: () => ipcRenderer.invoke('select-file'),
    downloadFile: (id, name) => ipcRenderer.invoke('download-file', { id, originalName: name }),
    deleteFile: (id) => ipcRenderer.invoke('delete-file', id),
    saveMetadata: (data) => ipcRenderer.invoke('save-metadata', data),
    loadMetadata: () => ipcRenderer.invoke('load-metadata'),
    logout: async () => { await ipcRenderer.invoke('lock-vault'); window.location.reload(); }
});
