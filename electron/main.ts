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

let mainWindow: BrowserWindow | null = null
let nextServer: ChildProcess | null = null

const isDev = !app.isPackaged
const PORT = isDev ? 3000 : 3456  // different port in prod to avoid conflicts

// ============================================================
// Start Next.js server (production mode)
// ============================================================
async function startNextServer(): Promise<void> {
  if (isDev) {
    // In dev, Next.js dev server should be running separately (npm run dev)
    return
  }

  const serverPath = path.join(process.resourcesPath, 'app', '.next', 'standalone', 'server.js')
  const publicDir = path.join(process.resourcesPath, 'app', 'public')

  return new Promise((resolve, reject) => {
    nextServer = spawn(process.execPath, [serverPath], {
      env: {
        ...process.env,
        PORT: String(PORT),
        NODE_ENV: 'production',
        NEXT_PUBLIC_ELECTRON: 'true',
        // Public dir for static assets
        NEXT_PUBLIC_DIR: publicDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    nextServer.stdout?.on('data', (data) => {
      console.log(`[Next.js] ${data.toString().trim()}`)
      if (data.toString().includes('Ready in')) resolve()
    })

    nextServer.stderr?.on('data', (data) => {
      console.error(`[Next.js err] ${data.toString().trim()}`)
    })

    nextServer.on('error', (err) => {
      console.error('Failed to start Next.js server:', err)
      reject(err)
    })

    // Resolve after 10s timeout if "Ready in" not detected
    setTimeout(resolve, 10000)
  })
}

// ============================================================
// Create main window
// ============================================================
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'BizBook Pro',
    icon: path.join(__dirname, '..', 'public', 'bizbook-pro-logo.png'),
    backgroundColor: '#0f172a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    // v4.153: Enable for fingerprint scanner hardware access
    // WebUSB and WebHID are available via these flags
    webSecurity: true,
    allowRunningInsecureContent: false,
  })

  // Load the app
  const url = isDev
    ? `http://localhost:${PORT}`
    : `http://localhost:${PORT}`

  mainWindow.loadURL(url)

  // Open external links in browser (not in Electron)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://localhost') || url.startsWith('https://localhost')) {
      return { action: 'allow' }
    }
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Handle links inside the app
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('http://localhost')) return
    event.preventDefault()
    shell.openExternal(url)
  })

  // Build menu
  const template: Electron.MenuTemplate = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Sale',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.send('menu-action', 'new-sale'),
        },
        {
          label: 'New Purchase',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => mainWindow?.webContents.send('menu-action', 'new-purchase'),
        },
        { type: 'separator' },
        {
          label: 'Export Data (Excel Backup)',
          accelerator: 'CmdOrCtrl+E',
          click: () => mainWindow?.webContents.send('menu-action', 'export-backup'),
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
          click: () => mainWindow?.webContents.send('menu-action', 'navigate-dashboard'),
        },
        {
          label: 'Sales',
          accelerator: 'CmdOrCtrl+2',
          click: () => mainWindow?.webContents.send('menu-action', 'navigate-sales'),
        },
        {
          label: 'Purchases',
          accelerator: 'CmdOrCtrl+3',
          click: () => mainWindow?.webContents.send('menu-action', 'navigate-purchases'),
        },
        {
          label: 'Inventory',
          accelerator: 'CmdOrCtrl+4',
          click: () => mainWindow?.webContents.send('menu-action', 'navigate-inventory'),
        },
        {
          label: 'GST Reports',
          accelerator: 'CmdOrCtrl+5',
          click: () => mainWindow?.webContents.send('menu-action', 'navigate-gst'),
        },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'AI Support Chat',
          accelerator: 'F1',
          click: () => mainWindow?.webContents.send('menu-action', 'help-chat'),
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

// v4.153: Fingerprint scanner IPC (placeholder — actual SDK integration in Wave 7)
ipcMain.handle('fingerprint:scan', async () => {
  // In Wave 7, this will:
  // 1. Detect connected USB fingerprint scanner (SecuGen / DigitalPersona)
  // 2. Capture fingerprint template
  // 3. Return base64-encoded template for matching
  //
  // For now, returns a not-implemented message
  return { success: false, error: 'Fingerprint scanner SDK not yet integrated. Use WebAuthn (Touch ID / Windows Hello) instead.' }
})

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
// App lifecycle
// ============================================================
app.whenReady().then(async () => {
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

// Security: prevent new-window creation (we use setWindowOpenHandler instead)
app.on('web-contents-created', (_, contents) => {
  contents.on('new-window', (event) => {
    event.preventDefault()
  })
})
