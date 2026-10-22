import { redirect } from "next/navigation";
import { getViewer } from "@/lib/dal";
import { MfaForm } from "./mfa-form";

export const metadata = { title: "Two-step verification — HomeStar Evidence Portal" };

export default async function MfaPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (viewer.aal === "aal2") redirect("/");

  return (
    <main className="auth-card">
      <h1>Two-step verification</h1>
      <MfaForm mode={viewer.hasVerifiedTotp ? "verify" : "enroll"} />
    </main>
  );
}
