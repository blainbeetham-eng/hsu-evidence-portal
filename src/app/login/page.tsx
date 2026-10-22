import { sendMagicLink } from "./actions";

export const metadata = { title: "Sign in — HomeStar Evidence Portal" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string }> }) {
  const { sent, error } = await searchParams;

  return (
    <main className="auth-card">
      <h1>HomeStar Evidence Portal</h1>
      {sent ? (
        <p>If that email address has access, a sign-in link is on its way. Open it in this browser.</p>
      ) : (
        <form action={sendMagicLink}>
          <label htmlFor="email">Email address</label>
          <input id="email" name="email" type="email" autoComplete="email" required />
          <button type="submit">Email me a sign-in link</button>
          {error === "link" && <p className="error">That sign-in link has expired or was already used. Request a new one.</p>}
          {error === "send" && <p className="error">Something went wrong sending the link. Try again in a minute.</p>}
          <p className="muted">Access is by invitation only.</p>
        </form>
      )}
    </main>
  );
}
