# How to Build the BizBook Pro Windows Desktop App (.exe)

This guide shows you 3 ways to build the Windows installer, depending on what machine you have.

---

## Option 1: Build ON a Windows machine (easiest, recommended)

If you have a Windows 10/11 PC:

### Step 1: Install prerequisites
1. **Node.js 18.18+** — download from https://nodejs.org (LTS version)
2. **Git** — download from https://git-scm.com
3. **Visual Studio Build Tools** (for native modules):
   - Download from https://visualstudio.microsoft.com/visual-cpp-build-tools/
   - During install, check "Desktop development with C++"

### Step 2: Clone the repo
```powershell
git clone https://github.com/pranjalgoswamighy86/bizbook-pro.git
cd bizbook-pro
```

### Step 3: Install dependencies
```powershell
npm install
```
This installs `electron`, `electron-builder`, and all other dependencies.

### Step 4: Build the Next.js app
```powershell
npm run build
```
This creates the standalone Next.js server in `.next/standalone/`.

### Step 5: Compile the Electron TypeScript
```powershell
npm run electron:compile
```
This compiles `electron/main.ts` and `electron/preload.ts` to JavaScript.

### Step 6: Build the .exe installer
```powershell
npm run electron:build
```

### Output
After ~5-10 minutes, you'll find:
```
dist-electron/
  bizbook-pro-setup-2.0.0.exe     ← NSIS installer (recommended for distribution)
  BizBookPro-Portable-2.0.0.exe   ← Portable version (no install needed)
  win-unpacked/
    BizBookPro.exe                ← Raw executable (for testing)
```

### Step 7: Test the installer
Double-click `bizbook-pro-setup-2.0.0.exe` to install. The app will:
- Create a desktop shortcut "BizBook Pro"
- Create a Start Menu entry
- Launch automatically after install

---

## Option 2: Build on macOS (cross-compile for Windows)

If you have a Mac, you can cross-compile a Windows .exe. **Limitation:** code signing won't work cross-platform, so the installer will show "Unknown publisher" warning.

### Step 1: Install prerequisites
```bash
# Node.js 18.18+ (if not already installed)
brew install node

# Git (usually pre-installed)
```

### Step 2: Clone + install
```bash
git clone https://github.com/pranjalgoswamighy86/bizbook-pro.git
cd bizbook-pro
npm install
```

### Step 3: Install Wine (for Windows cross-compilation)
```bash
brew install --cask wine-stable
```
Wine is needed because electron-builder uses it to package Windows executables on macOS.

### Step 4: Build
```bash
npm run build
npm run electron:compile
npm run electron:build
```

### Step 5: Output
Same as Option 1 — check `dist-electron/` for the .exe files.

> ⚠️ **Note:** The .exe built this way will work on Windows but will show "Unknown publisher" SmartScreen warning. Users need to click "More info → Run anyway". For signed installers, you must build on a Windows machine.

---

## Option 3: Build on Linux (Ubuntu/Debian)

### Step 1: Install prerequisites
```bash
# Node.js 18.18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Git
sudo apt-get install -y git

# Wine (for Windows cross-compilation)
sudo dpkg --add-architecture i386
sudo apt-get update
sudo apt-get install -y wine64 wine32
```

### Step 2: Clone + install
```bash
git clone https://github.com/pranjalgoswamighy86/bizbook-pro.git
cd bizbook-pro
npm install
```

### Step 3: Build
```bash
npm run build
npm run electron:compile
npm run electron:build
```

### Step 4: Output
Check `dist-electron/` for the .exe files.

---

## Option 4: Use GitHub Actions (no local machine needed)

If you don't have a Windows/Mac/Linux machine, you can use GitHub Actions to build in the cloud for free.

### Step 1: Create `.github/workflows/build-electron.yml`
```yaml
name: Build Windows Desktop App
on:
  push:
    tags:
      - 'v*'  # Trigger on version tags like v2.0.0
jobs:
  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
      - run: npm install
      - run: npm run build
      - run: npm run electron:compile
      - run: npm run electron:build
      - uses: actions/upload-artifact@v4
        with:
          name: bizbook-pro-windows
          path: dist-electron/*.exe
```

### Step 2: Trigger the build
```bash
git tag v2.0.0
git push origin v2.0.0
```

### Step 3: Download the .exe
1. Go to https://github.com/pranjalgoswamighy86/bizbook-pro/actions
2. Click the latest "Build Windows Desktop App" run
3. Scroll to "Artifacts" → download `bizbook-pro-windows`

---

## Development Mode (for testing)

If you just want to test the Electron app without building a full installer:

```bash
# Terminal 1: Start Next.js dev server
npm run dev

# Terminal 2: Launch Electron (after dev server is ready)
npm run electron:compile
npx electron electron/main.js
```

Or use the combined command:
```bash
npm run electron:dev
```
This starts both the Next.js dev server and Electron window together.

---

## Troubleshooting

### "Cannot find module 'electron'"
Run `npm install` again. Electron is in devDependencies.

### "Next.js server not starting" in packaged app
Ensure `npm run build` succeeded and `.next/standalone/server.js` exists.

### Window opens blank
1. Check if Next.js server is running on port 3456 (prod) or 3000 (dev)
2. Press F12 to open DevTools and check console errors
3. If you see `ERR_CONNECTION_REFUSED`, the Next.js server didn't start

### Installer shows "Unknown publisher"
This is expected for unsigned builds. To fix:
1. Buy a code signing certificate (~$200/year from DigiCert/Sectigo)
2. Set environment variables:
   ```bash
   # Windows
   set CSC_LINK=C:\path\to\certificate.pfx
   set CSC_KEY_PASSWORD=your_password

   # macOS/Linux
   export CSC_LINK=/path/to/certificate.pfx
   export CSC_KEY_PASSWORD=your_password
   ```
3. Run `npm run electron:build` again

### Build fails with "OutOfDiskSpace"
The build needs ~2 GB free space. Clean up:
```bash
rm -rf .next dist-electron node_modules/.cache
```

### Native module errors (fingerprint scanner)
If you're integrating the SecuGen/DigitalPersona SDK and get native module errors:
1. The `.node` file must be compiled for the same Electron version
2. Use `electron-rebuild`:
   ```bash
   npx electron-rebuild
   ```

---

## File Structure After Build

```
bizbook-pro/
├── .next/standalone/          ← Next.js standalone server
├── .next/static/              ← Static assets
├── public/                    ← Images, logos, service worker
├── electron/
│   ├── main.js                ← Compiled Electron main process
│   ├── preload.js             ← Compiled preload script
│   ├── fingerprint.js         ← Fingerprint SDK integration
│   └── main.ts / preload.ts   ← Source TypeScript
├── dist-electron/             ← OUTPUT: built installers
│   ├── bizbook-pro-setup-2.0.0.exe
│   ├── BizBookPro-Portable-2.0.0.exe
│   └── win-unpacked/
│       └── BizBookPro.exe
├── electron-builder.yml       ← Build configuration
└── package.json               ← Scripts and dependencies
```

---

## Quick Reference — Commands

| Command | What it does |
|---------|-------------|
| `npm run dev` | Start Next.js dev server (port 3000) |
| `npm run build` | Build Next.js for production |
| `npm run electron:compile` | Compile electron/*.ts to *.js |
| `npm run electron:dev` | Dev mode: Next.js + Electron together |
| `npm run electron:pack` | Pack without installer (faster testing) |
| `npm run electron:build` | Full build: creates .exe installer |
| `npx electron electron/main.js` | Launch Electron manually |

---

## What the Desktop App Includes

- ✅ Full BizBook Pro web app running in Electron
- ✅ Native menus (File, Edit, View, Navigate, Help)
- ✅ Keyboard shortcuts (Ctrl+N, Ctrl+E, Ctrl+1-5, F1)
- ✅ Auto-update support (via GitHub releases)
- ✅ Offline mode (PWA + IndexedDB cache)
- ✅ USB fingerprint scanner support (with SDK installed)
- ✅ Native file save dialogs
- ✅ Works without internet (after first login)

## What It Does NOT Include (yet)

- ❌ Code signing (requires certificate purchase)
- ❌ Auto-updater wired to GitHub (needs `electron-updater` package + release pipeline)
- ❌ Local database (still uses cloud PostgreSQL — local SQLite planned for future)
- ❌ Hardware fingerprint scanner SDK (requires SecuGen/DigitalPersona SDK installation)

For questions, contact support via the in-app AI Help Chat (F1).
