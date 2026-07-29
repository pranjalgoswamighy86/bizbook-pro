import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { SWUpdateModal } from "@/components/app/sw-update-modal";
// v4.155: Offline mode banner + IndexedDB cache indicator
import { OfflineBanner } from "@/components/app/offline-banner";
// v6.16: Global Electron menu-action bridge — must be mounted on EVERY
// page (login, company-select, main app) so the desktop app's menu bar
// works consistently. Lives for the entire page lifetime.
import { MenuActionBridge } from "@/components/app/menu-action-bridge";
// v6.16: Visible version badge — confirms which build is actually loaded
// (web + desktop). Critical diagnostic for the "menu bar doesn't work" issue.
import { VersionBadge } from "@/components/app/version-badge";

// v6.28.4: MOBILE PERFORMANCE — `display: "swap"` ensures text is rendered
// immediately with a fallback font, then swapped to Geist when it loads.
// This improves LCP (Largest Contentful Paint) by 200-500ms on mobile.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "BizBook Pro — A Product by Tahigo International",
  description: "The simplest billing & inventory software for growing businesses. Clean interface, powerful features, brilliant Accounting.",
  icons: {
    icon: "/favicon.png",
  },
  manifest: "/manifest.json",
  // v6.28.4: MOBILE PERFORMANCE — viewport configuration for responsive rendering.
  // `width=device-width` ensures the layout matches the device width.
  // `initialScale=1` prevents zoom on load. `maximumScale=5` allows pinch-zoom
  // for accessibility while preventing layout breakage.
  viewport: {
    width: "device-width",
    initialScale: 1,
    maximumScale: 5,
  },
  // v6.28.4: MOBILE PERFORMANCE — theme color for mobile browser chrome
  themeColor: "#059669",
  // v6.28.4: MOBILE PERFORMANCE — prefetch hints for faster LCP
  formatDetection: {
    telephone: false,
    address: false,
    email: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script src="https://checkout.razorpay.com/v1/checkout.js" async />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {/* v6.16: Global Electron menu bridge — mounted before children so
            it's guaranteed to be ready before any menu click can fire. */}
        <MenuActionBridge />
        {children}
        <Toaster />
        <SonnerToaster />
        {/* v6.28.23: SWUpdateModal DISABLED — was causing infinite reload loop.
            The component still renders null (no-op) but we keep it imported
            to avoid breaking the build. */}
        <SWUpdateModal />
        {/* v4.155: Offline mode banner + IndexedDB cache indicator */}
        <OfflineBanner />
        {/* v6.16: Version badge — confirms which build is loaded (web + desktop) */}
        <VersionBadge />
      </body>
    </html>
  );
}
