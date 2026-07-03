@echo off
title Tahigo International - BizBook Pro Installer
color 0A
echo.
echo  ============================================================================
echo.
echo                    TAHIGO INTERNATIONAL
echo.
echo                  BizBook Pro Installer
echo                    Version: v4.86
echo.
echo  ============================================================================
echo.
echo  Installing BizBook Pro Desktop Application...
echo.
echo  Step 1: Creating desktop shortcut...
echo.

REM Create VBScript to make a proper desktop shortcut
echo Set oWS = WScript.CreateObject("WScript.Shell") > "%TEMP%\bizbook_shortcut.vbs"
echo sLinkFile = "%USERPROFILE%\Desktop\BizBook Pro.lnk" >> "%TEMP%\bizbook_shortcut.vbs"
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> "%TEMP%\bizbook_shortcut.vbs"
echo oLink.TargetPath = "C:\Program Files\BizBookPro\BizBookPro.bat" >> "%TEMP%\bizbook_shortcut.vbs"
echo oLink.IconLocation = "shell32.dll,14" >> "%TEMP%\bizbook_shortcut.vbs"
echo oLink.Description = "BizBook Pro - by Tahigo International" >> "%TEMP%\bizbook_shortcut.vbs"
echo oLink.WindowStyle = 1 >> "%TEMP%\bizbook_shortcut.vbs"
echo oLink.Save >> "%TEMP%\bizbook_shortcut.vbs"
cscript //nologo "%TEMP%\bizbook_shortcut.vbs"
del "%TEMP%\bizbook_shortcut.vbs"

echo  Step 2: Creating application directory...
echo.
if not exist "C:\Program Files\BizBookPro" mkdir "C:\Program Files\BizBookPro"

echo  Step 3: Creating launcher script...
echo.
echo @echo off > "C:\Program Files\BizBookPro\BizBookPro.bat"
echo title BizBook Pro - Tahigo International >> "C:\Program Files\BizBookPro\BizBookPro.bat"
echo echo Launching BizBook Pro... >> "C:\Program Files\BizBookPro\BizBookPro.bat"
echo start "" "https://bizbook-pro-production.up.railway.app" >> "C:\Program Files\BizBookPro\BizBookPro.bat"

echo  Step 4: Creating Start Menu shortcut...
echo.
if not exist "%APPDATA%\Microsoft\Windows\Start Menu\Programs\BizBook Pro" mkdir "%APPDATA%\Microsoft\Windows\Start Menu\Programs\BizBook Pro"
echo Set oWS = WScript.CreateObject("WScript.Shell") > "%TEMP%\bizbook_startmenu.vbs"
echo sLinkFile = "%APPDATA%\Microsoft\Windows\Start Menu\Programs\BizBook Pro\BizBook Pro.lnk" >> "%TEMP%\bizbook_startmenu.vbs"
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> "%TEMP%\bizbook_startmenu.vbs"
echo oLink.TargetPath = "C:\Program Files\BizBookPro\BizBookPro.bat" >> "%TEMP%\bizbook_startmenu.vbs"
echo oLink.IconLocation = "shell32.dll,14" >> "%TEMP%\bizbook_startmenu.vbs"
echo oLink.Description = "BizBook Pro - by Tahigo International" >> "%TEMP%\bizbook_startmenu.vbs"
echo oLink.Save >> "%TEMP%\bizbook_startmenu.vbs"
cscript //nologo "%TEMP%\bizbook_startmenu.vbs"
del "%TEMP%\bizbook_startmenu.vbs"

echo  Step 5: Creating uninstaller...
echo.
echo @echo off > "C:\Program Files\BizBookPro\Uninstall.bat"
echo title Uninstall BizBook Pro >> "C:\Program Files\BizBookPro\Uninstall.bat"
echo echo Uninstalling BizBook Pro... >> "C:\Program Files\BizBookPro\Uninstall.bat"
echo del "%USERPROFILE%\Desktop\BizBook Pro.lnk" >> "C:\Program Files\BizBookPro\Uninstall.bat"
echo rmdir /s /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\BizBook Pro" >> "C:\Program Files\BizBookPro\Uninstall.bat"
echo rmdir /s /q "C:\Program Files\BizBookPro" >> "C:\Program Files\BizBookPro\Uninstall.bat"
echo echo Uninstall complete. >> "C:\Program Files\BizBookPro\Uninstall.bat"
echo pause >> "C:\Program Files\BizBookPro\Uninstall.bat"

echo  ============================================================================
echo.
echo                    INSTALLATION COMPLETE!
echo.
echo  ============================================================================
echo.
echo  BizBook Pro has been installed successfully.
echo.
echo  Desktop Shortcut:   Created (BizBook Pro)
echo  Start Menu:         Created (BizBook Pro)
echo  Install Location:   C:\Program Files\BizBookPro
echo  Uninstaller:        C:\Program Files\BizBookPro\Uninstall.bat
echo.
echo  The application connects to:
echo  https://bizbook-pro-production.up.railway.app
echo.
echo  Double-click "BizBook Pro" on your Desktop to launch.
echo.
echo  ============================================================================
echo.
echo  A Product by Tahigo International
echo  Version: v4.86
echo.
echo  ============================================================================
echo.
pause
