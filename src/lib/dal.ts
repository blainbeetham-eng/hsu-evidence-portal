import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Viewer = {
  userId: string;
  email: string | null;
  role: "admin" | "agency_user" | "landlord" | "installer" | null;
  aal: "aal1" | "aal2";
  hasVerifiedTotp: boolean;
};

/** The signed-in user, verified with the Auth server. Null if signed out. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return null;

  const [{ data: aal }, { data: profile }] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
  ]);

  return {
    userId: user.id,
    email: user.email ?? null,
    role: (profile?.role as Viewer["role"]) ?? null,
    aal: aal?.currentLevel === "aal2" ? "aal2" : "aal1",
    hasVerifiedTotp: (user.factors ?? []).some((f) => f.factor_type === "totp" && f.status === "verified"),
  };
});

/**
 * Phase 1: only admins use the portal. Signed out -> /login; no MFA yet -> /mfa;
 * any other role -> /no-access. The database applies the same rules via RLS.
 */
export async function requireAdmin(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (viewer.aal !== "aal2") redirect("/mfa");
  if (viewer.role !== "admin") redirect("/no-access");
  return viewer;
}
