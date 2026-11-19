import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FCCTV by Get Down Foundation",
  description: "Owner dashboard for FCCTV wearable cameras",
  icons: { icon: "/favicon.png", apple: "/logo-icon.png" },
  manifest: "/manifest.webmanifest",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#8a4b22" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
