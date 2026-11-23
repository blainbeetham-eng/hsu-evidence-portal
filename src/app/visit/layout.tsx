import Link from "next/link";
import type { Metadata, Viewport } from "next";
import { requireAdmin } from "@/lib/dal";
import { signOut } from "@/app/(admin)/actions";

export const metadata: Metadata = {
  title: "Quote visit — HomeStar Evidence Portal",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "HSU visit", statusBarStyle: "default" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1B5E20" };

// Phone layout for HSU's own quote visits (admin only, same sign-in and MFA as the portal).
export default async function VisitLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireAdmin();
  return (
    <>
      <header className="shell-header">
        <Link href="/properties" className="brand">HSU quote visit</Link>
        <nav />
        <span className="who">{viewer.email}</span>
        <form action={signOut}><button type="submit">Sign out</button></form>
      </header>
      <main className="field-main">{children}</main>
    </>
  );
}
