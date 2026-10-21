import "./globals.css";
import type { Metadata } from "next";
import AccountSessionBridge from "./AccountSessionBridge";

export const metadata: Metadata = {
  title: "Trade Journal",
  description: "Professional trading journal and analytics dashboard"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body><AccountSessionBridge>{children}</AccountSessionBridge></body>
    </html>
  );
}
