/**
 * v2.3.0: Electron Preload Script
 * Bridges the renderer (Next.js app) and main process securely.
 * Exposes only whitelisted APIs to window.electron.
 *
 * v2.3.0 CHANGES:
 *   - onMenuAction now returns an unsubscribe function so listeners can be
 *     cleaned up properly (prevents leak when components unmount).
 *   - Exposes `ping()` for the web app to verify the bridge is alive.
 *   - All listeners use a tracked-set so we can remove them on cleanup.
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electron', {
  // App info
  getVersion: () => ipcRenderer.invoke('app:version'),

  // v2.3.0: Diagnostic ping — verifies the Electron bridge is alive.
  ping: () => ipcRenderer.invoke('app:ping'),

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
    const handler = (_, progress) => callback(progress)
    ipcRenderer.on('fingerprint:enroll-progress', handler)
    return () => ipcRenderer.removeListener('fingerprint:enroll-progress', handler)
  },

  // v2.3.0: Menu action listener — returns an unsubscribe function.
  // The web app's MenuActionBridge uses this to cleanly detach when needed.
  onMenuAction: (callback: (action: string) => void) => {
    const handler = (_, action: string) => callback(action)
    ipcRenderer.on('menu-action', handler)
    return () => ipcRenderer.removeListener('menu-action', handler)
  },

  // v5.12: ESC/POS direct printing — bypasses browser entirely
  printEscpos: (data: any) =>
    ipcRenderer.invoke('print:escpos', data),

  // v5.8: Silent print + auto-detect APIs
  printInvoiceSilent: (url: string) =>
    ipcRenderer.invoke('print:invoice-silent', url),
  listPrinters: () =>
    ipcRenderer.invoke('print:list-printers'),
  autoDetectPaper: () =>
    ipcRenderer.invoke('print:auto-detect-paper'),
  printInvoiceToPrinter: (url: string, printerName: string) =>
    ipcRenderer.invoke('print:invoice-to-printer', url, printerName),

  // Platform info
  platform: process.platform,
  isElectron: true,
})
