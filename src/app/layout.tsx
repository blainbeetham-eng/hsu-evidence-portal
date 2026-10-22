import type { Metadata } from "next";
import { Cabin } from "next/font/google";
import "./globals.css";

const cabin = Cabin({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "HomeStar Evidence Portal",
  description: "Evidence records for Victorian rental minimum standards upgrades.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-AU">
      <body className={cabin.className}>{children}</body>
    </html>
  );
}
