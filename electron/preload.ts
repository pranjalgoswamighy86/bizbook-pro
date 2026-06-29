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

  // v4.154: Fingerprint scanner (full SDK integration)
  scanFingerprint: () => ipcRenderer.invoke('fingerprint:scan'),
  enrollFingerprint: () => ipcRenderer.invoke('fingerprint:enroll'),
  verifyFingerprint: (storedTemplates: any[]) =>
    ipcRenderer.invoke('fingerprint:verify', storedTemplates),
  isScannerAvailable: () => ipcRenderer.invoke('fingerprint:available'),
  getFingerprintSdkType: () => ipcRenderer.invoke('fingerprint:sdk-type'),

  // Enrollment progress (live updates during 3-sample enrollment)
  onEnrollProgress: (callback: (progress: { sample: number; total: number }) => void) => {
    ipcRenderer.on('fingerprint:enroll-progress', (_, progress) => callback(progress))
  },

  // Menu action listener (for File/Edit/Navigate menu items)
  onMenuAction: (callback: (action: string) => void) => {
    ipcRenderer.on('menu-action', (_, action: string) => callback(action))
  },

  // Platform info
  platform: process.platform,
  isElectron: true,
})
