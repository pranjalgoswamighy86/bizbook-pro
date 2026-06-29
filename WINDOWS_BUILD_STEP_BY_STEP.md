# Detailed Step-by-Step: Build BizBook Pro Windows .exe on Windows

This is the most detailed walkthrough for building the BizBook Pro desktop installer on a Windows 10 or Windows 11 machine. Follow every step in order. Do not skip any step.

---

## Prerequisites Check (before you start)

You need:
- ✅ A Windows 10 or Windows 11 PC (64-bit)
- ✅ At least 5 GB free disk space
- ✅ Administrator access (to install software)
- ✅ Internet connection (to download tools)
- ✅ Your GitHub account that has access to https://github.com/pranjalgoswamighy86/bizbook-pro

Time required: ~30-45 minutes (one-time setup) + ~10 minutes (each build)

---

## Step 1: Install Node.js LTS

Node.js is the JavaScript runtime that runs the build tools.

1. Open your browser and go to: **https://nodejs.org/en/download**
2. Click the **"Windows Installer (.msi)"** button for the **LTS version** (currently 20.x or 22.x — pick LTS, NOT "Current")
3. The download will start automatically. Wait for it to finish.
4. Double-click the downloaded `.msi` file (e.g., `node-v20.11.0-x64.msi`)
5. Click **Next** → check **"I accept the terms"** → click **Next**
6. Leave the destination folder as default (`C:\Program Files\nodejs\`) → click **Next**
7. On the **Custom Setup** screen, leave everything checked (including "Add to PATH") → click **Next**
8. Click **Install** → if Windows asks for permission, click **Yes**
9. Wait for installation to complete → click **Finish**

### Verify Node.js is installed

1. Press **Windows Key + R** to open the Run dialog
2. Type `cmd` and press **Enter** (opens Command Prompt)
3. In the black Command Prompt window, type:
   ```
   node --version
   ```
   Press Enter. You should see something like `v20.11.0`
4. Type:
   ```
   npm --version
   ```
   Press Enter. You should see something like `10.2.4`

If both commands show version numbers, Node.js is installed correctly. ✅

---

## Step 2: Install Git

Git is needed to download the BizBook Pro source code from GitHub.

1. Open your browser and go to: **https://git-scm.com/download/win**
2. The download should start automatically. If not, click **"Click here to download manually"**
3. Wait for the download to finish (file is ~50 MB)
4. Double-click the downloaded `.exe` file (e.g., `Git-2.43.0-64-bit.exe`)
5. Click **Next** on the welcome screen
6. Leave the destination folder as default → click **Next**
7. On the **Select Components** screen, leave everything default → click **Next**
8. On the **Start Menu folder** screen, click **Next**
9. On the **Default editor** screen, pick "Use Visual Studio Code as Git's default editor" (or "Use the Nano editor" if you don't have VS Code) → click **Next**
10. On **"Adjust the name of the initial branch"**, select "Let Git decide" → click **Next**
11. On **"Adjusting your PATH environment"**, select **"Git from the command line and also from 3rd-party software"** (this is the default) → click **Next**
12. On **"Choose the SSH executable"**, leave default → click **Next**
13. On **"Use HTTPS"**, leave default → click **Next**
14. On **"Checkout Windows-style, commit Unix-style"**, leave default → click **Next**
15. On **"Configure the terminal emulator"**, leave default → click **Next**
16. On **"Choose the default behavior of git pull"**, leave default → click **Next**
17. On **"Choose a credential helper"**, select **"Git Credential Manager"** → click **Next**
18. On **"Enable file system caching"**, leave default → click **Next**
19. On **"Enable experimental options"**, leave unchecked → click **Install**
20. Wait for installation → click **Finish**

### Verify Git is installed

1. Open a NEW Command Prompt (close the old one first — the PATH needs to refresh)
   - Press **Windows Key + R**, type `cmd`, press **Enter**
2. Type:
   ```
   git --version
   ```
   Press Enter. You should see `git version 2.43.0.windows.1` ✅

---

## Step 3: Install Visual Studio Build Tools

This is needed because some Node.js packages (like `electron` and native modules) require C++ compilation.

1. Open your browser and go to: **https://visualstudio.microsoft.com/visual-cpp-build-tools/**
2. Click the **"Download Build Tools"** button
3. Scroll down to **"Build Tools for Visual Studio 2022"** and click **"Download"**
4. Wait for the download (~5 MB installer, but it downloads more during install)
5. Double-click the downloaded `.exe` file (e.g., `vs_BuildTools.exe`)
6. If Windows asks for permission, click **Yes**
7. The Visual Studio Installer will open. It may take a minute to set up.
8. On the **Workloads** tab, find and CHECK the box that says:
   > **"Desktop development with C++"**
9. On the right side, under **"Installation details"**, you'll see a list of components. Make sure these are checked (they usually are by default):
   - ✅ MSVC v143 - VS 2022 C++ x64/x86 build tools
   - ✅ Windows 11 SDK (or Windows 10 SDK if you're on Windows 10)
   - ✅ C++ CMake tools for Windows
10. Click **"Install"** in the bottom right corner
11. Wait — this is a LARGE download (~6-8 GB). It will take 10-30 minutes depending on your internet speed.
12. When installation completes, click **"Close"**
13. **Restart your computer** (important — the PATH needs to update)

### Verify Build Tools are installed

1. After restart, open Command Prompt
2. Type:
   ```
   where cl
   ```
   Press Enter. You might see "INFO: Could not find files..." — that's OK, the tools are still installed, they just need to be loaded via the Developer Command Prompt.

If you got this far without errors, the Build Tools are installed. ✅

---

## Step 4: Download the BizBook Pro Source Code

Now we'll clone (download) the BizBook Pro code from GitHub.

1. Decide where you want to store the project. We recommend `C:\bizbook-pro`. Create this folder:
   - Open File Explorer → go to `C:\` → right-click empty space → **New** → **Folder** → name it `bizbook-pro`
2. Open Command Prompt:
   - Press **Windows Key + R**, type `cmd`, press **Enter**
3. Navigate to the C: drive:
   ```
   cd /d C:\
   ```
4. Clone the repository:
   ```
   git clone https://github.com/pranjalgoswamighy86/bizbook-pro.git
   ```
   Press Enter. Git will download the entire project (~50 MB, takes 1-2 minutes).
5. If Git asks for your GitHub username and password:
   - For username: enter your GitHub username
   - For password: you need a **Personal Access Token** (NOT your GitHub password)
     - Go to: https://github.com/settings/tokens
     - Click **"Generate new token"** → **"Generate new token (classic)"**
     - Give it a note like "BizBook build"
     - Expiration: 30 days
     - Check the box next to **"repo"** (full repository access)
     - Scroll down → click **"Generate token"**
     - Copy the token (starts with `ghp_...`) — you won't see it again
     - Paste this token as your password in Command Prompt
6. Once cloned, navigate into the project folder:
   ```
   cd bizbook-pro
   ```
7. Verify you're in the right place:
   ```
   dir
   ```
   You should see files like `package.json`, `next.config.ts`, `electron-builder.yml`, etc. ✅

---

## Step 5: Install Node.js Dependencies

This step downloads all the JavaScript packages BizBook Pro needs (Next.js, React, Electron, Prisma, etc.).

1. Make sure you're in the `C:\bizbook-pro` folder in Command Prompt
2. Run:
   ```
   npm install
   ```
   Press Enter.
3. This will take **5-15 minutes** depending on your internet speed. It downloads ~500 MB of packages.
4. You'll see lots of text scrolling by — that's normal.
5. If you see warnings like `npm WARN deprecated...`, ignore them. They're just warnings.
6. If you see errors (red text starting with `npm ERR!`), note the error message and try:
   ```
   npm cache clean --force
   npm install
   ```
7. When complete, you'll see something like:
   ```
   added 1523 packages in 8m
   ```
8. Verify the install worked:
   ```
   dir node_modules
   ```
   You should see many folders, including `electron`, `next`, `react`, `@prisma`, etc. ✅

---

## Step 6: Generate the Prisma Client

Prisma is the database layer. It needs to generate TypeScript types from the schema.

1. In Command Prompt (still in `C:\bizbook-pro`), run:
   ```
   npx prisma generate
   ```
2. Wait ~30 seconds. You should see:
   ```
   ✔ Generated Prisma Client (v6.19.2) to ./node_modules/@prisma/client
   ```
   ✅

---

## Step 7: Build the Next.js Web App

This compiles the React/Next.js code into a production-ready bundle.

1. In Command Prompt, run:
   ```
   npm run build
   ```
2. This takes **3-7 minutes**. You'll see:
   - Lots of "Compiled" messages
   - A list of routes (/, /api/auth, /api/sales, etc.)
   - Post-build script output ("[POSTBUILD]")
3. If the build succeeds, you'll see at the end:
   ```
   [POSTBUILD] Final standalone size: 36.8 MB
   ```
4. If you get errors:
   - **"Cannot find module 'X'"** → run `npm install` again
   - **TypeScript errors** → these are pre-existing and don't block the build (we have `typescript: { ignoreBuildErrors: true }` in next.config.ts)
   - **Out of memory** → close other apps, try again
5. Verify the build output exists:
   ```
   dir .next\standalone\server.js
   ```
   You should see the file. ✅

---

## Step 8: Compile the Electron TypeScript

Electron's main process files are written in TypeScript. We need to compile them to JavaScript.

1. In Command Prompt, run:
   ```
   npm run electron:compile
   ```
2. Wait ~10 seconds. You should see no errors.
3. Verify the compiled files exist:
   ```
   dir electron\main.js electron\preload.js
   ```
   You should see both files. ✅

---

## Step 9: Build the Windows .exe Installer

This is the final step — it packages everything into a Windows installer.

1. In Command Prompt, run:
   ```
   npm run electron:build
   ```
2. This takes **5-10 minutes**. The process:
   - Copies the Next.js standalone build
   - Copies the public folder (logos, service worker)
   - Packages everything with Electron
   - Creates an NSIS installer (.exe)
   - Creates a portable version (.exe)
3. You'll see output like:
   ```
   • electron-builder  version=25.1.8
   • packaging         platform=win32 arch=x64
   • building          target=nsis file=dist-electron\bizbook-pro-setup-2.0.0.exe
   • building          target=portable file=dist-electron\BizBookPro-Portable-2.0.0.exe
   ```
4. If you see warnings like "Cannot sign" — that's OK, it just means the installer isn't code-signed (users will see "Unknown publisher" warning).
5. When complete, you'll see:
   ```
   • build completed in 2m 34s
   ```

### Find your .exe files

1. Open File Explorer
2. Navigate to: `C:\bizbook-pro\dist-electron\`
3. You should see:
   - `bizbook-pro-setup-2.0.0.exe` — **NSIS installer** (recommended for distribution)
   - `BizBookPro-Portable-2.0.0.exe` — Portable version (no install needed)
   - `win-unpacked\` folder — contains the raw `BizBookPro.exe`

✅ **You've built the Windows desktop app!**

---

## Step 10: Test the Installer

### Test the NSIS installer
1. Double-click `bizbook-pro-setup-2.0.0.exe`
2. Windows SmartScreen may show "Windows protected your PC" — click **"More info"** → **"Run anyway"**
3. The installer will open. Click **Next** → **Next** → **Install**
4. Wait for installation to complete
5. Click **Finish** — BizBook Pro should launch automatically
6. The app window should open, showing the login page
7. Check your desktop — there should be a "BizBook Pro" shortcut
8. Check Start Menu → you should see "BizBook Pro"

### Test the portable version
1. Double-click `BizBookPro-Portable-2.0.0.exe`
2. Windows SmartScreen warning → "More info" → "Run anyway"
3. The app should launch directly (no installation)
4. When you close it, no traces are left on the system

### Uninstall
- To uninstall: Settings → Apps → find "BizBook Pro" → click Uninstall
- Or: Start Menu → BizBook Pro → right-click → Uninstall

---

## Step 11: Distribute the .exe

### To share with one person
- Send them `bizbook-pro-setup-2.0.0.exe` via Google Drive, Dropbox, WeTransfer, or email (if under 25 MB — the installer is ~50 MB so use a file-sharing service)
- Tell them: "Download and double-click to install. If Windows shows 'Unknown publisher', click 'More info' → 'Run anyway'. This is safe — we just haven't purchased a code signing certificate yet."

### To distribute publicly
- Upload to your website (e.g., https://www.tahigo.in/download)
- Or upload to GitHub Releases:
  1. Go to https://github.com/pranjalgoswamighy86/bizbook-pro/releases
  2. Click **"Draft a new release"**
  3. Tag: `v2.0.0` (or whatever version)
  4. Title: "BizBook Pro v2.0.0 — Windows Desktop App"
  5. Drag and drop `bizbook-pro-setup-2.0.0.exe` into the attachments area
  6. Click **"Publish release"**
  7. Share the release URL: `https://github.com/pranjalgoswamighy86/bizbook-pro/releases/tag/v2.0.0`

---

## Updating the App

When you make code changes and want a new .exe:

1. Open Command Prompt
2. Navigate to the project:
   ```
   cd /d C:\bizbook-pro
   ```
3. Get the latest code:
   ```
   git pull origin main
   ```
4. Install any new dependencies:
   ```
   npm install
   ```
5. Bump the version number in `package.json`:
   - Open `C:\bizbook-pro\package.json` in Notepad or VS Code
   - Change `"version": "2.0.0"` to `"version": "2.1.0"` (or whatever)
   - Save the file
6. Rebuild:
   ```
   npm run build
   npm run electron:compile
   npm run electron:build
   ```
7. The new .exe will be in `dist-electron\bizbook-pro-setup-2.1.0.exe`

---

## Troubleshooting Common Errors

### Error: "'electron' is not recognized as an internal or external command"
**Cause:** Electron didn't install properly.
**Fix:**
```
npm install electron@latest --save-dev
```

### Error: "Cannot find module 'next'"
**Cause:** npm install didn't complete.
**Fix:**
```
rm -rf node_modules
npm cache clean --force
npm install
```

### Error: "Error: EPERM: operation not permitted, unlink"
**Cause:** A file is locked (usually by another program or the previous Electron instance still running).
**Fix:**
1. Close all running BizBook Pro / Electron windows
2. Open Task Manager (Ctrl+Shift+Esc)
3. End any processes named "BizBook Pro" or "electron.exe"
4. Try the build again

### Error: "Out of disk space"
**Cause:** Not enough free space.
**Fix:** You need at least 2 GB free. Delete old builds:
```
rmdir /s /q dist-electron
rmdir /s /q .next
```
Then try the build again.

### Error: "gyp ERR! find VS"
**Cause:** Visual Studio Build Tools not installed or not the right version.
**Fix:**
1. Make sure you installed "Desktop development with C++" workload (Step 3)
2. Restart your computer
3. Run `npm config set msvs_version 2022`
4. Try `npm install` again

### Error: "The system cannot find the path specified"
**Cause:** Path is too long (Windows has a 260-character limit by default).
**Fix:**
1. Open Registry Editor (Win+R → `regedit`)
2. Navigate to: `HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\FileSystem`
3. Find `LongPathsEnabled` → set to `1`
4. Restart Command Prompt

### Build is very slow (more than 15 minutes)
**Cause:** Antivirus scanning every file, or slow disk.
**Fix:**
1. Add `C:\bizbook-pro` to your antivirus exclusion list
2. Make sure you're not on a network drive

### Window opens but shows blank white page
**Cause:** Next.js server didn't start.
**Fix:**
1. Press F12 to open DevTools
2. Check the Console tab for errors
3. If you see "ERR_CONNECTION_REFUSED", the Next.js server failed to start
4. Try running the Next.js server manually to see the error:
   ```
   set NODE_ENV=production
   set PORT=3456
   node .next\standalone\server.js
   ```

---

## Quick Command Reference

Copy-paste these in order:

```cmd
:: 1. Get the code
cd /d C:\
git clone https://github.com/pranjalgoswamighy86/bizbook-pro.git
cd bizbook-pro

:: 2. Install everything
npm install

:: 3. Generate Prisma client
npx prisma generate

:: 4. Build Next.js
npm run build

:: 5. Compile Electron TypeScript
npm run electron:compile

:: 6. Build the .exe installer
npm run electron:build

:: 7. Open the output folder
explorer dist-electron
```

---

## What You Get

After completing all steps, you'll have:

| File | Size | Purpose |
|------|------|---------|
| `dist-electron\bizbook-pro-setup-2.0.0.exe` | ~85 MB | NSIS installer (recommended) |
| `dist-electron\BizBookPro-Portable-2.0.0.exe` | ~85 MB | Portable version (no install) |
| `dist-electron\win-unpacked\BizBookPro.exe` | ~85 MB | Raw executable (for testing) |

The installer creates:
- Desktop shortcut: "BizBook Pro"
- Start Menu entry: "BizBook Pro"
- Installation folder: `C:\Users\{username}\AppData\Local\Programs\bizbook-pro\`
- Uninstaller entry in Settings → Apps

---

## Need Help?

If you get stuck:
1. Check the **Troubleshooting** section above
2. Open the in-app AI Help Chat (F1) from the web version at https://carefree-success-production-7766.up.railway.app
3. Email: support@tahigo.in
4. Or open an issue on GitHub: https://github.com/pranjalgoswamighy86/bizbook-pro/issues

Good luck! 🚀
