/**
 * v4.153: Electron Preload Script
 * Bridges the renderer (Next.js app) and main process securely.
 * Exposes only whitelisted APIs to window.electron.
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electron', {
  // App info
  getVersion: () => ipcRenderer.invoke('app:version'),

  // Native dialogs
  saveFileDialog: (defaultName: string, filters: any[]) =>
    ipcRenderer.invoke('dialog:save-file', defaultName, filters),

  // Fingerprint scanner (Wave 7)
  scanFingerprint: () => ipcRenderer.invoke('fingerprint:scan'),

  // Menu action listener (for File/Edit/Navigate menu items)
  onMenuAction: (callback: (action: string) => void) => {
    ipcRenderer.on('menu-action', (_, action: string) => callback(action))
  },

  // Platform info
  platform: process.platform,
  isElectron: true,
})
