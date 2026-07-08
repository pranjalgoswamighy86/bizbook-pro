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

  /** v4.154: Capture a single fingerprint template (base64 ISO 19794-2) */
  scanFingerprint(): Promise<{ success: boolean; template?: string; quality?: number; image?: string; error?: string }>

  /** v4.154: Enroll a new fingerprint (3 samples merged into one template) */
  enrollFingerprint(): Promise<{ success: boolean; template?: string; quality?: number; samplesCaptured?: number; error?: string }>

  /** v4.154: Verify a captured fingerprint against a list of stored staff templates */
  verifyFingerprint(storedTemplates: Array<{ staffId: string; templateB64: string }>): Promise<{ success: boolean; matchedStaffId?: string; matchScore?: number; error?: string }>

  /** v4.154: Check if a USB fingerprint scanner is connected */
  isScannerAvailable(): Promise<boolean>

  /** v4.154: Returns the active SDK type ('secugen', 'digitalpersona', 'webhid', 'none') */
  getFingerprintSdkType(): Promise<{ sdkType: string; nativeLoaded: boolean }>

  /** v4.154: Subscribe to enrollment progress updates (sample 1/3, 2/3, 3/3) */
  onEnrollProgress(callback: (progress: { sample: number; total: number }) => void): void

  /** Subscribe to menu actions (File/New Sale, View/Reload, etc.)
   *  v2.3.0: Now returns an unsubscribe function for clean teardown. */
  onMenuAction(callback: (action: string) => void): () => void

  /** v2.3.0: Diagnostic ping — verifies the Electron bridge is alive
   *  and returns the desktop shell version + Electron/Chrome/Node versions. */
  ping(): Promise<{ ok: boolean; desktopVersion: string; electron: string; timestamp: number }>

  /** The platform we're running on (win32, darwin, linux) */
  platform: NodeJS.Platform

  /** True if running inside Electron desktop app */
  isElectron: true
}

interface Window {
  electron?: ElectronAPI
}
