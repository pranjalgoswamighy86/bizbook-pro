import { NextRequest, NextResponse } from 'next/server'
import { readFile, stat } from 'fs/promises'
import { join } from 'path'

// =====================================================================
// Desktop App Download Route — v5.1
// =====================================================================
// Serves the Electron desktop app installer files.
//
// Currently available:
// - Linux: BizBookPro-2.0.0.AppImage (380 MB) — built and ready
// - Windows: .exe — NOT YET BUILT (requires Windows CI runner)
// - macOS: .dmg — NOT YET BUILT (requires macOS CI runner)
//
// For Windows/Mac, the route redirects to GitHub Releases page
// where the installers will be hosted once GitHub Actions builds them.
//
// Query params:
//   ?platform=linux  → serves AppImage directly
//   ?platform=windows → redirects to GitHub Releases
//   ?platform=mac     → redirects to GitHub Releases
// =====================================================================

export const dynamic = 'force-dynamic'

const GITHUB_RELEASES_URL = 'https://github.com/pranjalgoswamighy86/bizbook-pro/releases/latest'

// Possible locations for the Linux AppImage
const LINUX_APPIMAGE_PATHS = [
  '/home/z/my-project/download/BizBookPro-2.0.0.AppImage',
  '/home/z/my-project/dist-electron/BizBook Pro-2.0.0.AppImage',
  join(process.cwd(), 'download', 'BizBookPro-2.0.0.AppImage'),
  join(process.cwd(), 'dist-electron', 'BizBook Pro-2.0.0.AppImage'),
]

export async function GET(req: NextRequest) {
  const platform = (req.nextUrl.searchParams.get('platform') || '').toLowerCase()

  if (platform === 'windows' || platform === 'win') {
    // Windows .exe not yet built — redirect to GitHub Releases
    return NextResponse.redirect(GITHUB_RELEASES_URL, 302)
  }

  if (platform === 'mac' || platform === 'macos' || platform === 'darwin') {
    // macOS .dmg not yet built — redirect to GitHub Releases
    return NextResponse.redirect(GITHUB_RELEASES_URL, 302)
  }

  if (platform === 'linux') {
    // Try to find and serve the AppImage
    for (const filePath of LINUX_APPIMAGE_PATHS) {
      try {
        const fileStat = await stat(filePath)
        if (fileStat.isFile()) {
          const fileBuffer = await readFile(filePath)
          return new NextResponse(fileBuffer, {
            headers: {
              'Content-Type': 'application/octet-stream',
              'Content-Disposition': `attachment; filename="BizBookPro-2.0.0.AppImage"`,
              'Content-Length': fileStat.size.toString(),
              'Cache-Control': 'no-cache',
            },
          })
        }
      } catch {
        // File not found at this path, try next
      }
    }

    // AppImage not found on this server — redirect to GitHub Releases
    return NextResponse.redirect(GITHUB_RELEASES_URL, 302)
  }

  // Unknown platform — redirect to GitHub Releases
  return NextResponse.redirect(GITHUB_RELEASES_URL, 302)
}
