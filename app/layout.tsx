import "./globals.css";
import type { Metadata } from "next";

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
      <body>{children}</body>
    </html>
  );
}
