"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function sendMagicLink(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) redirect("/login");

  const origin = (await headers()).get("origin") ?? "";
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    // Invite-only: never create an account from the login form.
    options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/callback` },
  });

  // Unknown addresses return an error too; show the same message so the form
  // does not reveal who has an account. Only surface rate limits and outages.
  if (error && error.status !== 400 && error.status !== 422) redirect("/login?error=send");
  redirect("/login?sent=1");
}
