import { signOut } from "@/app/(admin)/actions";

export const metadata = { title: "No access yet — HomeStar Evidence Portal" };

export default function NoAccessPage() {
  return (
    <main className="auth-card">
      <h1>No access yet</h1>
      <p>Your account exists, but the portal is not open to your role yet. HomeStar Upgrades will let you know when it is.</p>
      <form action={signOut}>
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}
