/**
 * v4.153: Electron Main Process — BizBook Pro Desktop App
 * ============================================================
 * Wraps the Next.js web app as a desktop application (.exe for Windows).
 *
 * Architecture:
 *   - Electron main process (this file) creates a BrowserWindow
 *   - In DEV mode: loads localhost:3000 (Next.js dev server must be running)
 *   - In PROD mode: starts the standalone Next.js server as a child process
 *     and loads http://localhost:PORT
 *   - Offline-first PWA cache handles intermittent connectivity
 *   - Native menus for File, Edit, View, Help
 *   - Auto-updates via electron-updater (configured in electron-builder.yml)
 *
 * Build commands:
 *   - npm run electron:dev    — dev mode (Next.js dev server + Electron)
 *   - npm run electron:build  — production build (creates .exe installer)
 *   - npm run electron:pack   — pack without installer (faster testing)
 *
 * Output:
 *   - dist/bizbook-pro-setup-<version>.exe (NSIS installer for Windows)
 *   - dist/win-unpacked/BizBookPro.exe (portable executable)
 */

import { app, BrowserWindow, Menu, shell, dialog, ipcMain } from 'electron'
import * as path from 'path'
import { spawn, ChildProcess } from 'child_process'
// v4.154: USB fingerprint scanner SDK (SecuGen / DigitalPersona)
import { initFingerprintSDK, registerFingerprintIpc, getSdkType } from './fingerprint'
// v5.12: ESC/POS direct printing — bypasses browser print engine entirely
// Sends raw ESC/POS commands directly to the thermal printer via USB
// This is the ONLY reliable way to print on 58mm thermal paper on Windows

let mainWindow: BrowserWindow | null = null
let nextServer: ChildProcess | null = null

const isDev = !app.isPackaged
const PORT = isDev ? 3000 : 3456  // different port in prod to avoid conflicts

// v5.6: The desktop app loads the Railway web app directly instead of
// running a local Next.js server. This fixes the blank window issue
// (local server needed DATABASE_URL which wasn't available).
// Silent thermal printing still works via Electron's webContents.print.
const APP_URL = isDev
  ? `http://localhost:${PORT}`
  : 'https://carefree-success-production-7766.up.railway.app/'

// ============================================================
// v5.4: WINDOW SPAWN KILL SWITCH
// ============================================================
// Tracks window creation timestamps. If more than 3 windows are created
// within 10 seconds, force-quit the app immediately to prevent the
// infinite window spawn loop that crashes the PC.
const windowCreateTimes: number[] = []
const MAX_WINDOWS_IN_WINDOW = 3
const WINDOW_TIMEFRAME_MS = 10000

function checkWindowSpawnLimit(): boolean {
  const now = Date.now()
  windowCreateTimes.push(now)
  // Remove entries older than the timeframe
  while (windowCreateTimes.length > 0 && now - windowCreateTimes[0] > WINDOW_TIMEFRAME_MS) {
    windowCreateTimes.shift()
  }
  if (windowCreateTimes.length > MAX_WINDOWS_IN_WINDOW) {
    console.error(`[KILL SWITCH] ${windowCreateTimes.length} windows created in ${WINDOW_TIMEFRAME_MS}ms — FORCE QUITTING to prevent crash`)
    // Kill the Next.js server first
    if (nextServer) {
      try { nextServer.kill('SIGTERM') } catch {}
    }
    app.quit()
    process.exit(1)
    return false
  }
  return true
}

// ============================================================
// Start Next.js server (production mode)
// ============================================================
async function startNextServer(): Promise<void> {
  // v5.6: In production, we load the Railway URL directly — no local server needed
  if (!isDev) {
    console.log('[Electron] Production mode — loading Railway URL directly, no local server')
    return
  }

  // In dev, Next.js dev server should be running separately (npm run dev)
  return
}

// ============================================================
// Create main window
// ============================================================
function createWindow() {
  // v5.4: Kill switch — check if too many windows are being created
  if (!checkWindowSpawnLimit()) return

  // v5.4: If mainWindow already exists, just focus it — don't create another
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
    return
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'BizBook Pro',
    icon: path.join(__dirname, '..', 'public', 'bizbook-pro-icon.ico'),
    backgroundColor: '#0f172a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  // Load the app with retry logic
  // v5.6: In production, load the Railway URL directly (no local server)
  const url = APP_URL
  let loadAttempts = 0
  const maxAttempts = 10

  const tryLoadUrl = () => {
    loadAttempts++
    console.log(`[Electron] Load attempt ${loadAttempts}/${maxAttempts} → ${url}`)
    mainWindow?.loadURL(url).catch((err) => {
      console.error(`[Electron] Load failed (attempt ${loadAttempts}):`, err.message)
    })
  }

  // Retry loading if the server isn't ready yet
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.log(`[Electron] did-fail-load: ${errorCode} ${errorDescription}`)
    if (loadAttempts < maxAttempts) {
      setTimeout(tryLoadUrl, 1500)
    }
  })

  // Initial load attempt (with small delay to let server start in dev mode)
  setTimeout(tryLoadUrl, isDev ? 2000 : 500)

  // v6.3: Allow print preview windows (about:blank) but block everything else
  // This fixes the "print preview not supported" issue in Electron.
  // The web app calls window.open('', '_blank') to show print preview.
  // We allow about:blank windows so the preview can display.
  // All other external URLs open in the user's default browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.log('[Window Open Handler]', url)

    // ALLOW about:blank windows (used by print preview)
    if (url === 'about:blank' || url === '') {
      console.log('[Window Open] Allowed: about:blank (print preview)')
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 900,
          height: 700,
          title: 'Print Preview — BizBook Pro',
          webPreferences: {
            contextIsolation: true,
          },
        }
      }
    }

    // ALLOW internal navigation (Railway app + localhost dev)
    const isInternal = url.startsWith('http://localhost') ||
                       url.startsWith('https://localhost') ||
                       url.startsWith('http://127.0.0.1') ||
                       url.includes('carefree-success-production-7766.up.railway.app')
    if (isInternal) {
      console.log('[Window Open] Allowed: internal URL')
      return { action: 'allow' }
    }

    // DENY everything else — open in external browser
    console.log('[Window Open] Blocked: external URL → opening in browser')
    shell.openExternal(url).catch(() => {})
    return { action: 'deny' }
  })

  // Handle links inside the app
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isInternal = url.startsWith('http://localhost') ||
                       url.startsWith('http://127.0.0.1') ||
                       url.includes('carefree-success-production-7766.up.railway.app')
    if (isInternal) return
    event.preventDefault()
    shell.openExternal(url)
  })

  // v6.14.2: Centralized menu action sender with retry
  // Sends IPC message + executeJavaScript fallback
  // Retries up to 3 times if the web app hasn't loaded the listener yet
  const sendMenuAction = (action: string) => {
    console.log(`[Menu] Sending action: ${action}`)
    // Method 1: IPC
    mainWindow?.webContents.send('menu-action', action)
    // Method 2: Direct JS injection (works even if IPC listener isn't ready)
    mainWindow?.webContents.executeJavaScript(`
      if (window.__bizbookMenuAction) {
        window.__bizbookMenuAction('${action}');
        true;
      } else {
        // Retry: inject a pending action that the web app will pick up when ready
        if (!window.__pendingMenuActions) window.__pendingMenuActions = [];
        window.__pendingMenuActions.push('${action}');
        false;
      }
    `).then((result: boolean) => {
      if (!result) {
        // Listener not ready — retry after 1 second
        console.log(`[Menu] Listener not ready, retrying in 1s...`)
        setTimeout(() => {
          mainWindow?.webContents.executeJavaScript(`
            if (window.__bizbookMenuAction) {
              window.__bizbookMenuAction('${action}');
              true;
            } else { false; }
          `).catch(() => {})
        }, 1000)
      }
    }).catch(() => {})
  }

  // Build menu
  const template: any = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Sale',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendMenuAction('new-sale'),
        },
        {
          label: 'New Purchase',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => sendMenuAction('new-purchase'),
        },
        { type: 'separator' },
        {
          label: 'Export Data (Excel Backup)',
          accelerator: 'CmdOrCtrl+E',
          click: () => sendMenuAction('export-backup'),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Navigate',
      submenu: [
        {
          label: 'Dashboard',
          accelerator: 'CmdOrCtrl+1',
          click: () => sendMenuAction('navigate-dashboard'),
        },
        {
          label: 'Sales',
          accelerator: 'CmdOrCtrl+2',
          click: () => sendMenuAction('navigate-sales'),
        },
        {
          label: 'Purchases',
          accelerator: 'CmdOrCtrl+3',
          click: () => sendMenuAction('navigate-purchases'),
        },
        {
          label: 'Inventory',
          accelerator: 'CmdOrCtrl+4',
          click: () => sendMenuAction('navigate-inventory'),
        },
        {
          label: 'GST Reports',
          accelerator: 'CmdOrCtrl+5',
          click: () => sendMenuAction('navigate-gst'),
        },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'AI Support Chat',
          accelerator: 'F1',
          click: () => sendMenuAction('help-chat'),
        },
        {
          label: 'Keyboard Shortcuts',
          accelerator: 'CmdOrCtrl+/',
          click: () => {
            dialog.showMessageBox(mainWindow!, {
              type: 'info',
              title: 'Keyboard Shortcuts',
              message: 'BizBook Pro Keyboard Shortcuts',
              detail: [
                'File → New Sale:           Ctrl+N',
                'File → New Purchase:       Ctrl+Shift+N',
                'File → Export Backup:      Ctrl+E',
                'View → Reload:             Ctrl+R',
                'View → Dev Tools:          F12',
                'View → Full Screen:        F11',
                'Navigate → Dashboard:      Ctrl+1',
                'Navigate → Sales:          Ctrl+2',
                'Navigate → Purchases:      Ctrl+3',
                'Navigate → Inventory:      Ctrl+4',
                'Navigate → GST Reports:    Ctrl+5',
                'Help → AI Support Chat:    F1',
                '',
                'Barcode scanner: just scan — input auto-focuses on the last open barcode field.',
              ].join('\n'),
            })
          },
        },
        { type: 'separator' },
        {
          label: 'About BizBook Pro',
          click: () => {
            dialog.showMessageBox(mainWindow!, {
              type: 'info',
              title: 'About BizBook Pro',
              message: 'BizBook Pro v4.153',
              detail: [
                'Premium Business Software by Tahigo International',
                'GST-compliant billing, inventory, accounting, payroll',
                '',
                'Office: Guwahati, Assam, India',
                'Website: https://www.tahigo.in',
                'Support: in-app AI Support Chat (F1)',
                '',
                '© 2026 Tahigo International. All rights reserved.',
              ].join('\n'),
            })
          },
        },
        {
          label: 'Check for Updates',
          click: () => mainWindow?.webContents.send('menu-action', 'check-updates'),
        },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ============================================================
// IPC handlers (for fingerprint scanner, native dialogs, etc.)
// ============================================================

// v4.154: Fingerprint scanner IPC — full SDK integration (Wave 7)
// All fingerprint IPC handlers (scan, enroll, verify, available, sdk-type) are
// registered by registerFingerprintIpc() in fingerprint.ts

// v4.153: Native file save dialog (for backups)
ipcMain.handle('dialog:save-file', async (_, defaultName: string, filters: any[]) => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    defaultPath: defaultName,
    filters: filters || [
      { name: 'Excel files', extensions: ['xlsx'] },
      { name: 'JSON files', extensions: ['json'] },
      { name: 'All files', extensions: ['*'] },
    ],
  })
  return result.canceled ? null : result.filePath
})

// v4.153: App version info
ipcMain.handle('app:version', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  platform: process.platform,
}))

// ============================================================
// v5.8: PRINTER AUTO-DETECTION + SILENT PRINT
// ============================================================
// Auto-detects paper size from the default printer's name:
//   - "58mm" / "58" / "everycom-58" / "thermal" / "receipt" → 58mm thermal
//   - "80mm" / "80" / "pos" / "star" / "epson tm" / "bixolon" → 80mm thermal
//   - Anything else → A4
//
// Then silently prints the invoice URL to the default printer — NO dialog.

// Get list of installed printers with auto-detected paper size
ipcMain.handle('print:list-printers', async () => {
  if (!mainWindow) return { printers: [] }
  try {
    const printers = await mainWindow.webContents.getPrintersAsync()
    return {
      printers: printers.map(p => {
        const fullName = (p.name + ' ' + (p.displayName || '')).toLowerCase()
        let detectedPaper = 'a4'
        let isThermal = false
        // 58mm thermal printers (Everycom-58, etc.)
        if (/58mm|58|everycom|escpos|pos-?58/.test(fullName)) {
          detectedPaper = '58mm'
          isThermal = true
        }
        // 80mm thermal printers (standard POS receipt printers)
        else if (/80mm|80|thermal|receipt|pos|star|epson tm|bixolon/.test(fullName)) {
          detectedPaper = '80mm'
          isThermal = true
        }
        return {
          name: p.name,
          displayName: p.displayName,
          isDefault: p.isDefault,
          isThermal,
          detectedPaper,
        }
      }),
    }
  } catch (err: any) {
    return { printers: [], error: err?.message }
  }
})

// Auto-detect paper size from default printer
ipcMain.handle('print:auto-detect-paper', async () => {
  if (!mainWindow) return { paper: 'a4' }
  try {
    const printers = await mainWindow.webContents.getPrintersAsync()
    const defaultPrinter = printers.find(p => p.isDefault)
    if (!defaultPrinter) return { paper: 'a4' }
    const fullName = (defaultPrinter.name + ' ' + (defaultPrinter.displayName || '')).toLowerCase()
    if (/58mm|58|everycom|escpos|pos-?58/.test(fullName)) {
      return { paper: '58mm', printerName: defaultPrinter.name }
    }
    if (/80mm|80|thermal|receipt|pos|star|epson tm|bixolon/.test(fullName)) {
      return { paper: '80mm', printerName: defaultPrinter.name }
    }
    return { paper: 'a4', printerName: defaultPrinter.name }
  } catch (err: any) {
    return { paper: 'a4', error: err?.message }
  }
})

// ============================================================
// v5.13: ESC/POS DIRECT PRINTING — Raw commands, no native deps
// ============================================================
// Generates raw ESC/POS byte commands and sends them to the printer
// via Windows print spooler (copy /b command) or lpr (Linux/Mac).
// This avoids the escpos-usb native dependency that fails to build
// on Windows CI.

interface EscposItem {
  name: string
  qty: number
  unit?: string
  rate: number
  total: number
}

// Generate raw ESC/POS commands as a Buffer
function generateEscposCommands(data: {
  sellerName: string
  sellerAddr?: string
  sellerPhone?: string
  sellerGst?: string
  buyerName: string
  buyerAddr?: string
  invNo: string
  invDate: string
  status: string
  items: EscposItem[]
  subtotal: number
  taxAmount: number
  totalAmount: number
  amountReceived: number
  balanceDue: number
  paperWidth: string
}): Buffer {
  const cmds: number[] = []
  const width = data.paperWidth === '58mm' ? 32 : 48

  // ESC @ — initialize printer
  cmds.push(0x1B, 0x40)

  // Helper: add text
  const addText = (text: string) => {
    for (let i = 0; i < text.length; i++) {
      cmds.push(text.charCodeAt(i))
    }
  }

  // Helper: add line
  const addLine = (text: string) => {
    addText(text)
    cmds.push(0x0A) // LF
  }

  // Helper: center text
  const center = () => { cmds.push(0x1B, 0x61, 0x01) }
  // Helper: left align
  const left = () => { cmds.push(0x1B, 0x61, 0x00) }
  // Helper: bold on
  const boldOn = () => { cmds.push(0x1B, 0x45, 0x01) }
  // Helper: bold off
  const boldOff = () => { cmds.push(0x1B, 0x45, 0x00) }
  // Helper: double size
  const doubleSize = () => { cmds.push(0x1D, 0x21, 0x11) }
  // Helper: normal size
  const normalSize = () => { cmds.push(0x1D, 0x21, 0x00) }
  // Helper: feed lines
  const feed = (n: number) => { cmds.push(0x1B, 0x64, n) }
  // Helper: cut paper
  const cut = () => { cmds.push(0x1D, 0x56, 0x00) }

  const padRight = (text: string, len: number) => text.substring(0, len).padEnd(len)
  const padLeft = (text: string, len: number) => text.substring(0, len).padStart(len)

  // Header — seller name (centered, double size, bold)
  center()
  doubleSize()
  boldOn()
  addLine(data.sellerName)
  boldOff()
  normalSize()

  // Seller details
  if (data.sellerAddr) addLine(data.sellerAddr)
  if (data.sellerPhone) addLine('Ph: ' + data.sellerPhone)
  if (data.sellerGst) addLine('GSTIN: ' + data.sellerGst)

  feed(1)

  // INVOICE title
  center()
  boldOn()
  addLine('INVOICE')
  boldOff()

  feed(1)

  // Invoice details
  left()
  addLine('Invoice: ' + data.invNo)
  addLine('Date: ' + data.invDate)
  addLine('Status: ' + data.status)

  feed(1)

  // Bill To
  addLine('Bill To:')
  boldOn()
  addLine(data.buyerName)
  boldOff()
  if (data.buyerAddr) addLine(data.buyerAddr)

  feed(1)

  // Separator
  addLine('='.repeat(width))

  // Items header
  boldOn()
  const itemCol = Math.floor(width * 0.5)
  const qtyCol = Math.floor(width * 0.2)
  const totCol = width - itemCol - qtyCol
  addLine(padRight('Item', itemCol) + padLeft('Qty', qtyCol) + padLeft('Total', totCol))
  boldOff()
  addLine('-'.repeat(width))

  // Items
  for (const item of data.items) {
    const itemName = (item.name || '').substring(0, itemCol)
    const qty = `${item.qty} ${item.unit || ''}`.substring(0, qtyCol)
    const total = 'Rs ' + (item.total || 0).toFixed(2)
    addLine(padRight(itemName, itemCol) + padLeft(qty, qtyCol) + padLeft(total, totCol))
  }

  addLine('-'.repeat(width))
  feed(1)

  // Totals
  addLine(padRight('Subtotal', width - 10) + padLeft('Rs ' + data.subtotal.toFixed(2), 10))
  addLine(padRight('Tax', width - 10) + padLeft('Rs ' + data.taxAmount.toFixed(2), 10))

  boldOn()
  addLine(padRight('GRAND TOTAL', width - 10) + padLeft('Rs ' + data.totalAmount.toFixed(2), 10))
  boldOff()

  addLine(padRight('Received', width - 10) + padLeft('Rs ' + data.amountReceived.toFixed(2), 10))
  addLine(padRight('Balance Due', width - 10) + padLeft('Rs ' + data.balanceDue.toFixed(2), 10))

  feed(2)

  // Footer
  center()
  addLine('Authorised Signatory')
  addLine('For ' + data.sellerName)
  feed(1)
  addLine('Computer-generated by BizBook Pro')
  addLine('Tahigo International')

  feed(2)
  cut()

  return Buffer.from(cmds)
}

ipcMain.handle('print:escpos', async (_, data: {
  sellerName: string
  sellerAddr?: string
  sellerPhone?: string
  sellerGst?: string
  buyerName: string
  buyerAddr?: string
  invNo: string
  invDate: string
  status: string
  items: EscposItem[]
  subtotal: number
  taxAmount: number
  totalAmount: number
  amountReceived: number
  balanceDue: number
  paperWidth: string
}) => {
  try {
    console.log('[escpos] Generating ESC/POS commands for', data.paperWidth)

    // Generate raw ESC/POS commands
    const buffer = generateEscposCommands(data)
    console.log('[escpos] Generated', buffer.length, 'bytes')

    // Get default printer name
    let printerName: string | undefined
    try {
      const printers = await mainWindow!.webContents.getPrintersAsync()
      const defaultPrinter = printers.find(p => p.isDefault)
      printerName = defaultPrinter?.name
      console.log('[escpos] Default printer:', printerName)
    } catch (e) {
      console.warn('[escpos] Could not get default printer:', e)
    }

    if (!printerName) {
      return { ok: false, error: 'No default printer found' }
    }

    // Save ESC/POS data to temp file
    const fs = await import('fs')
    const os = await import('os')
    const pathMod = await import('path')
    const tempFile = pathMod.join(os.tmpdir(), `bizbook-escpos-${Date.now()}.bin`)
    fs.writeFileSync(tempFile, buffer)
    console.log('[escpos] Saved to temp file:', tempFile)

    // Send to printer via OS command
    const { exec } = await import('child_process')
    const { promisify } = await import('util')
    const execAsync = promisify(exec)

    if (process.platform === 'win32') {
      // Windows: copy /b tempfile \\computer\printer OR copy /b tempfile "Printer Name"
      // Use the printer name directly with copy /b
      const cmd = `copy /b "${tempFile}" "${printerName}"`
      console.log('[escpos] Windows command:', cmd)
      try {
        await execAsync(cmd)
        console.log('[escpos] Print succeeded')
        fs.unlinkSync(tempFile)
        return { ok: true }
      } catch (err: any) {
        console.error('[escpos] Windows copy failed:', err.message)
        // Try alternative: use PRINT command
        try {
          const cmd2 = `print /D:"${printerName}" "${tempFile}"`
          console.log('[escpos] Trying PRINT command:', cmd2)
          await execAsync(cmd2)
          console.log('[escpos] PRINT succeeded')
          fs.unlinkSync(tempFile)
          return { ok: true }
        } catch (err2: any) {
          console.error('[escpos] PRINT also failed:', err2.message)
          fs.unlinkSync(tempFile)
          return { ok: false, error: `Print failed: ${err2.message}` }
        }
      }
    } else if (process.platform === 'darwin') {
      // macOS: lpr
      const cmd = `lpr -P "${printerName}" "${tempFile}"`
      console.log('[escpos] macOS command:', cmd)
      await execAsync(cmd)
      fs.unlinkSync(tempFile)
      return { ok: true }
    } else {
      // Linux: lpr
      const cmd = `lpr -P "${printerName}" "${tempFile}"`
      console.log('[escpos] Linux command:', cmd)
      await execAsync(cmd)
      fs.unlinkSync(tempFile)
      return { ok: true }
    }
  } catch (err: any) {
    console.error('[escpos] Error:', err)
    return { ok: false, error: err?.message || 'ESC/POS print failed' }
  }
})

// Silent print — loads URL in hidden window, prints with no dialog
// v5.10: Improved silent print with better error handling
ipcMain.handle('print:invoice-silent', async (_, url: string) => {
  if (!mainWindow) {
    return { ok: false, error: 'Main window not available' }
  }
  try {
    // Get the default printer name
    let defaultPrinterName: string | undefined
    try {
      const printers = await mainWindow.webContents.getPrintersAsync()
      const defaultPrinter = printers.find(p => p.isDefault)
      defaultPrinterName = defaultPrinter?.name
      console.log('[silent-print] Default printer:', defaultPrinterName)
    } catch (e) {
      console.warn('[silent-print] Could not get default printer:', e)
    }

    const printWindow = new BrowserWindow({
      show: false,
      width: 800,
      height: 600,
      webPreferences: {
        contextIsolation: true,
      },
    })
    console.log('[silent-print] Loading URL:', url)
    await printWindow.loadURL(url)
    // Wait for fonts/images to settle (longer for thermal)
    console.log('[silent-print] Waiting 2s for page to render...')
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Silent print with deviceName
    console.log('[silent-print] Calling webContents.print({silent: true})...')
    try {
      await printWindow.webContents.print({
        silent: true,
        printBackground: true,
        deviceName: defaultPrinterName,
      })
      console.log('[silent-print] Print call completed successfully')
      printWindow.close()
      return { ok: true }
    } catch (printErr: any) {
      console.error('[silent-print] Print failed:', printErr?.message)
      printWindow.close()
      return { ok: false, error: printErr?.message || 'Print failed' }
    }
  } catch (err: any) {
    console.error('[silent-print] Error:', err)
    return { ok: false, error: err?.message || 'Unknown print error' }
  }
})

// ============================================================
// App lifecycle
// ============================================================
app.whenReady().then(async () => {
  // v4.154: Initialize fingerprint scanner SDK
  await initFingerprintSDK()
  registerFingerprintIpc()
  console.log(`[Fingerprint] SDK initialized: ${getSdkType()}`)

  await startNextServer()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // Kill the Next.js server
  if (nextServer) {
    nextServer.kill('SIGTERM')
    nextServer = null
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  if (nextServer) {
    nextServer.kill('SIGTERM')
    nextServer = null
  }
})

// v6.3: Global window handler — allow about:blank (print preview), block externals
app.on('web-contents-created', (_, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    console.log('[Global Window Open Handler]', url)

    // ALLOW about:blank (used by print preview)
    if (url === 'about:blank' || url === '') {
      return { action: 'allow' }
    }

    // ALLOW internal URLs
    const isInternal = url.startsWith('http://localhost') ||
                       url.startsWith('https://localhost') ||
                       url.startsWith('http://127.0.0.1') ||
                       url.includes('carefree-success-production-7766.up.railway.app')
    if (isInternal) {
      return { action: 'allow' }
    }

    // DENY everything else
    shell.openExternal(url).catch(() => {})
    return { action: 'deny' }
  })
})
