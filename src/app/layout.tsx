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

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BizBook Pro — A Product by Tahigo International",
  description: "The simplest billing & inventory software for growing businesses. Clean interface, powerful features, brilliant Accounting.",
  icons: {
    icon: "/favicon.png",
  },
  manifest: "/manifest.json",
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
        {/* v4.8: PWA Service Worker Update Interceptor (Spec Section 20) */}
        <SWUpdateModal />
        {/* v4.155: Offline mode banner + IndexedDB cache indicator */}
        <OfflineBanner />
        {/* v6.16: Version badge — confirms which build is loaded (web + desktop) */}
        <VersionBadge />
      </body>
    </html>
  );
}
