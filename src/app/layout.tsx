import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { SWUpdateModal } from "@/components/app/sw-update-modal";
// v4.155: Offline mode banner + IndexedDB cache indicator
import { OfflineBanner } from "@/components/app/offline-banner";

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
        {children}
        <Toaster />
        <SonnerToaster />
        {/* v4.8: PWA Service Worker Update Interceptor (Spec Section 20) */}
        <SWUpdateModal />
        {/* v4.155: Offline mode banner + IndexedDB cache indicator */}
        <OfflineBanner />
      </body>
    </html>
  );
}
