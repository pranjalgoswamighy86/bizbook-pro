/**
 * v4.153: Type declarations for window.electron (Electron preload bridge)
 * Use this in the Next.js app to access native desktop features.
 */

interface ElectronAPI {
  /** Returns app version, Electron version, Chrome version, Node version, platform */
  getVersion(): Promise<{
    version: string
    electron: string
    chrome: string
    node: string
    platform: NodeJS.Platform
  }>

  /** Opens a native Save File dialog and returns the chosen path (or null if cancelled) */
  saveFileDialog(defaultName: string, filters?: Array<{ name: string; extensions: string[] }>): Promise<string | null>

  /** Triggers a fingerprint scan (returns base64 template or error). Wave 7 will implement. */
  scanFingerprint(): Promise<{ success: boolean; template?: string; error?: string }>

  /** Subscribe to menu actions (File/New Sale, View/Reload, etc.) */
  onMenuAction(callback: (action: string) => void): void

  /** The platform we're running on (win32, darwin, linux) */
  platform: NodeJS.Platform

  /** True if running inside Electron desktop app */
  isElectron: true
}

interface Window {
  electron?: ElectronAPI
}
