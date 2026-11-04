import Link from "next/link";
import type { Metadata, Viewport } from "next";
import { requireFieldUser } from "@/lib/dal";
import { signOut } from "@/app/(admin)/actions";

export const metadata: Metadata = {
  title: "HSU field team",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "HSU field", statusBarStyle: "default" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1B5E20" };

export default async function FieldLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireFieldUser();
  return (
    <>
      <header className="shell-header">
        <Link href="/field" className="brand">HSU field team</Link>
        <nav />
        <span className="who">{viewer.email}</span>
        <form action={signOut}><button type="submit">Sign out</button></form>
      </header>
      <main className="field-main">{children}</main>
    </>
  );
}
