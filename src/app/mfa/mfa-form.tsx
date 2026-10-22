"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Props = { mode: "enroll" | "verify" };

export function MfaForm({ mode }: Props) {
  const router = useRouter();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      if (mode === "verify") {
        const { data, error } = await supabase.auth.mfa.listFactors();
        if (error) return setError(error.message);
        setFactorId(data.totp.find((f) => f.status === "verified")?.id ?? null);
        return;
      }
      // Remove any half-finished enrolment, then start a fresh one.
      const { data: factors } = await supabase.auth.mfa.listFactors();
      for (const f of factors?.all ?? []) {
        if (f.factor_type === "totp" && f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Authenticator app" });
      if (error) return setError(error.message);
      setFactorId(data.id);
      setQr(data.totp.qr_code);
      setSecret(data.totp.secret);
    })();
  }, [mode]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    setBusy(false);
    if (error) return setError("That code didn't work. Check the time on your phone and try the next code.");
    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={submit}>
      {mode === "enroll" ? (
        <>
          <p>Scan this QR code with an authenticator app (Microsoft Authenticator, Google Authenticator or 1Password), then enter the 6-digit code it shows.</p>
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="QR code for your authenticator app" width={200} height={200} className="qr" />
          ) : (
            !error && <p className="muted">Preparing…</p>
          )}
          {secret && <p className="muted small">Can&apos;t scan? Enter this key instead: <code>{secret}</code></p>}
        </>
      ) : (
        <p>Enter the 6-digit code from your authenticator app.</p>
      )}
      <label htmlFor="code">Code</label>
      <input
        id="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        required
      />
      <button type="submit" disabled={busy || !factorId}>{busy ? "Checking…" : "Verify"}</button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
