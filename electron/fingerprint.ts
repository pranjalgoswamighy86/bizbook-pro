/**
 * v4.154: USB Fingerprint Scanner SDK Integration
 * ============================================================
 * Supports SecuGen and DigitalPersona USB fingerprint scanners
 * for biometric staff attendance.
 *
 * Hardware Supported:
 *   - SecuGen Hamster Pro 20 (USB)
 *   - SecuGen Hamster Plus (USB)
 *   - DigitalPersona U.are.U 4500 (USB)
 *   - DigitalPersona U.are.U 5160 (USB)
 *
 * Native Module Loading:
 *   This file is ONLY loaded in the Electron main process (Node.js context).
 *   It dynamically loads native addon modules (.node files) at runtime.
 *   If no native module is installed, it falls back to:
 *     1. WebHID API (browser-native, requires Electron Chromium)
 *     2. WebAuthn (Touch ID / Windows Hello / Android fingerprint)
 *
 * To enable native SDK support on Windows:
 *   1. Install the SDK runtime from the scanner manufacturer:
 *      - SecuGen: https://secugen.com/products/sdk/
 *      - DigitalPersona: https://www.crossmatch.com/developer/
 *   2. Copy the .node native addon to electron/native-addons/
 *   3. Set env var: FINGERPRINT_SDK=secugen|digitalpersona
 *
 * Enrollment Flow:
 *   1. Admin opens Staff module → clicks "Enroll Fingerprint"
 *   2. User places finger on scanner 3 times (for quality)
 *   3. SDK returns ISO 19794-2 template (typically 400-600 bytes)
 *   4. We base64-encode and store on Staff.fingerprintId
 *   5. Staff.biometricType = 'USB_SCANNER'
 *
 * Verification Flow (check-in/out):
 *   1. Staff places finger on scanner
 *   2. SDK captures template
 *   3. We compare against ALL enrolled staff.fingerprintId templates
 *   4. On match, POST /api/attendance with method='FINGERPRINT'
 *   5. Audio feedback (success beep / failure buzz)
 */

import { ipcMain, BrowserWindow } from 'electron'
import * as path from 'path'
import * as fs from 'fs'

let nativeAddon: any = null
let sdkType: 'secugen' | 'digitalpersona' | 'webhid' | 'none' = 'none'

// ============================================================
// Initialize — try to load native SDK, fall back to WebHID
// ============================================================
export async function initFingerprintSDK(): Promise<void> {
  const sdkPref = process.env.FINGERPRINT_SDK

  // Try SecuGen first
  if (!sdkPref || sdkPref === 'secugen') {
    try {
      const addonPath = path.join(__dirname, '..', 'native-addons', 'secugen', 'secugen.node')
      if (fs.existsSync(addonPath)) {
        nativeAddon = require(addonPath)
        sdkType = 'secugen'
        console.log('[Fingerprint] SecuGen SDK loaded')
        return
      }
    } catch (err: any) {
      console.warn('[Fingerprint] SecuGen load failed:', err?.message)
    }
  }

  // Try DigitalPersona
  if (!sdkPref || sdkPref === 'digitalpersona') {
    try {
      const addonPath = path.join(__dirname, '..', 'native-addons', 'digitalpersona', 'dpfp.node')
      if (fs.existsSync(addonPath)) {
        nativeAddon = require(addonPath)
        sdkType = 'digitalpersona'
        console.log('[Fingerprint] DigitalPersona SDK loaded')
        return
      }
    } catch (err: any) {
      console.warn('[Fingerprint] DigitalPersona load failed:', err?.message)
    }
  }

  // Fall back to WebHID (works in Chromium / Electron renderer)
  sdkType = 'webhid'
  console.log('[Fingerprint] No native SDK found — using WebHID fallback')
}

// ============================================================
// Get current SDK type
// ============================================================
export function getSdkType(): string {
  return sdkType
}

// ============================================================
// Check if any scanner is available
// ============================================================
export async function isScannerAvailable(): Promise<boolean> {
  if (nativeAddon) {
    try {
      return nativeAddon.isDeviceConnected()
    } catch {
      return false
    }
  }
  // WebHID: assume available if renderer supports it
  return true
}

// ============================================================
// Capture — acquire a fingerprint template from the scanner
// Returns ISO 19794-2 template as base64 string
// ============================================================
export async function captureFingerprint(): Promise<{
  success: boolean
  template?: string       // base64-encoded ISO template
  quality?: number        // 0-100
  image?: string          // base64 BMP preview (optional)
  error?: string
}> {
  if (!nativeAddon) {
    return {
      success: false,
      error: 'No native fingerprint SDK loaded. Use WebHID via renderer, or install SecuGen/DigitalPersona SDK.',
    }
  }

  try {
    // Native SDK call — each SDK has slightly different API
    if (sdkType === 'secugen') {
      const result = nativeAddon.captureTemplate(10000)  // 10s timeout
      return {
        success: true,
        template: Buffer.from(result.template).toString('base64'),
        quality: result.quality,
        image: result.imageBmp ? Buffer.from(result.imageBmp).toString('base64') : undefined,
      }
    }

    if (sdkType === 'digitalpersona') {
      const result = nativeAddon.captureFingerprint('VERIFY')
      return {
        success: true,
        template: Buffer.from(result.templateData).toString('base64'),
        quality: result.qualityScore,
      }
    }

    return { success: false, error: `Unknown SDK type: ${sdkType}` }
  } catch (err: any) {
    return { success: false, error: `Capture failed: ${err?.message || 'Unknown'}` }
  }
}

// ============================================================
// Enroll — capture 3 samples and create a consolidated template
// ============================================================
export async function enrollFingerprint(): Promise<{
  success: boolean
  template?: string       // base64-encoded enrollment template
  quality?: number
  samplesCaptured?: number
  error?: string
}> {
  if (!nativeAddon) {
    return {
      success: false,
      error: 'Enrollment requires native SDK. Install SecuGen or DigitalPersona SDK.',
    }
  }

  try {
    const samples: Buffer[] = []
    const requiredSamples = 3

    for (let i = 0; i < requiredSamples; i++) {
      // Notify renderer to show "Place finger (N/3)" UI
      BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('fingerprint:enroll-progress', { sample: i + 1, total: requiredSamples })
      })

      const capture = await captureFingerprint()
      if (!capture.success || !capture.template) {
        return { success: false, error: `Sample ${i + 1} failed: ${capture.error}` }
      }
      samples.push(Buffer.from(capture.template, 'base64'))

      // Pause between samples (lift finger, place again)
      if (i < requiredSamples - 1) {
        await new Promise(r => setTimeout(r, 1500))
      }
    }

    // Merge templates into a single enrollment template
    if (sdkType === 'secugen') {
      const merged = nativeAddon.mergeTemplates(samples)
      return {
        success: true,
        template: Buffer.from(merged.template).toString('base64'),
        quality: merged.quality,
        samplesCaptured: requiredSamples,
      }
    }

    if (sdkType === 'digitalpersona') {
      const enrollment = nativeAddon.createEnrollment(samples)
      return {
        success: true,
        template: Buffer.from(enrollment.template).toString('base64'),
        quality: enrollment.quality,
        samplesCaptured: requiredSamples,
      }
    }

    return { success: false, error: `Unknown SDK for enrollment: ${sdkType}` }
  } catch (err: any) {
    return { success: false, error: `Enrollment failed: ${err?.message || 'Unknown'}` }
  }
}

// ============================================================
// Verify — match a captured template against stored templates
// ============================================================
export async function verifyFingerprint(
  capturedTemplateB64: string,
  storedTemplates: Array<{ staffId: string; templateB64: string }>
): Promise<{
  success: boolean
  matchedStaffId?: string
  matchScore?: number
  error?: string
}> {
  if (!nativeAddon) {
    return {
      success: false,
      error: 'Verification requires native SDK.',
    }
  }

  try {
    const captured = Buffer.from(capturedTemplateB64, 'base64')

    for (const candidate of storedTemplates) {
      const stored = Buffer.from(candidate.templateB64, 'base64')
      let matched = false
      let score = 0

      if (sdkType === 'secugen') {
        const result = nativeAddon.matchTemplates(captured, stored)
        matched = result.matched
        score = result.score
      } else if (sdkType === 'digitalpersona') {
        const result = nativeAddon.verify(captured, stored)
        matched = result.matched
        score = result.matchScore
      }

      // Match threshold: SecuGen typically > 40, DigitalPersona > 25
      const threshold = sdkType === 'secugen' ? 40 : 25
      if (matched && score >= threshold) {
        return { success: true, matchedStaffId: candidate.staffId, matchScore: score }
      }
    }

    return { success: false, error: 'No match found' }
  } catch (err: any) {
    return { success: false, error: `Verify failed: ${err?.message || 'Unknown'}` }
  }
}

// ============================================================
// Register IPC handlers — called from main.ts
// ============================================================
export function registerFingerprintIpc(): void {
  // Capture single fingerprint
  ipcMain.handle('fingerprint:scan', async () => {
    return await captureFingerprint()
  })

  // Enroll (3 samples)
  ipcMain.handle('fingerprint:enroll', async () => {
    return await enrollFingerprint()
  })

  // Verify against a list of stored templates
  ipcMain.handle('fingerprint:verify', async (_, storedTemplates: Array<{ staffId: string; templateB64: string }>) => {
    // Capture
    const capture = await captureFingerprint()
    if (!capture.success || !capture.template) {
      return { success: false, error: capture.error }
    }
    // Verify
    return await verifyFingerprint(capture.template, storedTemplates)
  })

  // Check scanner availability
  ipcMain.handle('fingerprint:available', async () => {
    return await isScannerAvailable()
  })

  // Get SDK type
  ipcMain.handle('fingerprint:sdk-type', () => {
    return { sdkType, nativeLoaded: !!nativeAddon }
  })
}
