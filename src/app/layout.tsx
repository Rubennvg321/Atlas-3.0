import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Atlas", template: "%s · Atlas" },
  description: "Klant- en projectbeheer Steps & Stairs",
  manifest: "/manifest.webmanifest",
  // iPhone/iPad: als app op het beginscherm, met eigen pictogram en zonder Safari-balk.
  appleWebApp: { capable: true, title: "Atlas", statusBarStyle: "default" },
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }, { url: "/icon-192.png", sizes: "192x192" }], apple: "/apple-touch-icon.png" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1c1917" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <body>{children}</body>
    </html>
  );
}
