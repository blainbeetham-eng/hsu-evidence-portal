import Link from "next/link";
import { requireAdmin } from "@/lib/dal";
import { signOut } from "./actions";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireAdmin();

  return (
    <>
      <header className="shell-header">
        <Link href="/" className="brand">HomeStar Evidence Portal</Link>
        <nav>
          <Link href="/">Overview</Link>
          <Link href="/properties">Properties</Link>
          <Link href="/work-orders">Work orders</Link>
        </nav>
        <span className="who">{viewer.email}</span>
        <form action={signOut}>
          <button type="submit">Sign out</button>
        </form>
      </header>
      <main className="shell-main">{children}</main>
    </>
  );
}
