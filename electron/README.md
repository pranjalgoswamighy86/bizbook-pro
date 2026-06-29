# BizBook Pro — Desktop App (Electron)

This directory contains the Electron wrapper that packages the Next.js web app as a Windows desktop application (.exe).

## Quick Start

### Prerequisites
- Node.js 18.18+
- Windows 10/11 (for .exe build) — macOS/Linux can build for their own platform

### Install Electron dependencies
```bash
npm install
```

### Development mode
Run Next.js dev server + Electron window together:
```bash
npm run electron:dev
```

### Build the installer
Produces `dist-electron/bizbook-pro-setup-2.0.0.exe` (NSIS installer) and `dist-electron/BizBookPro-Portable-2.0.0.exe` (portable):

```bash
npm run electron:build
```

### Pack without installer (faster testing)
Produces `dist-electron/win-unpacked/BizBookPro.exe`:

```bash
npm run electron:pack
```

## Architecture

```
electron/
├── main.ts           — Main process (creates BrowserWindow, manages Next.js server, native menus)
├── preload.ts        — Secure bridge between renderer (Next.js) and main process
├── tsconfig.json     — TypeScript config for Electron files (CommonJS output)
└── build/            — Build resources (icons, installer graphics)

electron-builder.yml  — Build config (NSIS, portable, AppImage, dmg targets)
```

## How it works

1. **In DEV mode**: Electron loads `http://localhost:3000` — your Next.js dev server must be running (`npm run dev`).
2. **In PROD mode (packaged)**: Electron spawns the standalone Next.js server (`server.js`) as a child process and loads `http://localhost:3456`.

The standalone build (`.next/standalone/`) is automatically created by `next build` because `next.config.ts` has `output: "standalone"`.

## Features

### Native menus
- **File**: New Sale (Ctrl+N), New Purchase (Ctrl+Shift+N), Export Backup (Ctrl+E)
- **Edit**: Undo, Redo, Cut, Copy, Paste, Select All
- **View**: Reload, Force Reload, DevTools, Zoom, Full Screen
- **Navigate**: Dashboard (Ctrl+1), Sales (Ctrl+2), Purchases (Ctrl+3), Inventory (Ctrl+4), GST Reports (Ctrl+5)
- **Help**: AI Support Chat (F1), Keyboard Shortcuts (Ctrl+/), About, Check for Updates

### IPC bridge (window.electron)
The Next.js app can call native features via `window.electron`:
- `window.electron.getVersion()` — app version info
- `window.electron.saveFileDialog(name, filters)` — native Save dialog
- `window.electron.scanFingerprint()` — USB fingerprint scanner (Wave 7)
- `window.electron.onMenuAction(callback)` — receive menu clicks

### Auto-updates
Configured via `electron-updater` (not yet wired). When ready:
1. Push a new tag to GitHub: `git tag v2.0.1 && git push origin v2.0.1`
2. GitHub Actions builds the .exe and creates a Release
3. Desktop app checks for updates on startup and prompts user to install

## Building for distribution

### Windows (.exe)
```bash
npm run electron:build
# Output: dist-electron/bizbook-pro-setup-2.0.0.exe
```

### macOS (.dmg)
```bash
npm run electron:build
# Output: dist-electron/BizBook Pro-2.0.0.dmg
```
Note: macOS builds require code signing for distribution. For internal use, build unsigned.

### Linux (.AppImage)
```bash
npm run electron:build
# Output: dist-electron/BizBook Pro-2.0.0.AppImage
```

## Code signing (optional, for distribution)

To sign the Windows installer with a code signing certificate:
1. Purchase a code signing certificate (DigiCert, Sectigo, etc.)
2. Export as PFX file
3. Set environment variables:
   ```
   CSC_LINK=path/to/certificate.pfx
   CSC_KEY_PASSWORD=your_password
   ```
4. Run `npm run electron:build`

The signed installer will not trigger SmartScreen warnings on Windows.

## Troubleshooting

**Error: "Cannot find module 'electron'"**
→ Run `npm install` to install devDependencies.

**Error: "Next.js server not starting"**
→ Ensure `npm run build` succeeded and `.next/standalone/server.js` exists.

**Window opens blank**
→ Check if Next.js server is running on port 3456 (prod) or 3000 (dev).
→ Open DevTools (F12) to see console errors.

**Installer shows "Unknown publisher"**
→ Build is unsigned. Either sign with a certificate or instruct users to click "More info → Run anyway".

## Wave 7: Fingerprint scanner

The `electron/main.ts` already has a `fingerprint:scan` IPC handler stub. Wave 7 will:
1. Add `@secugen/sdk` or `digitalpersona-sdk` npm package
2. Detect connected USB scanner via `node-usb`
3. Capture fingerprint template
4. Match against `Staff.fingerprintId` (added in v4.149 schema migration)
5. Trigger check-in/check-out via `/api/attendance`

Currently falls back to WebAuthn (Touch ID / Windows Hello / Android fingerprint) via the existing `fingerprint-scanner.tsx` component.
