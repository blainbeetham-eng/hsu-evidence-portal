"use server";
import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/dal";
import type { ActionResult } from "../properties/[id]/actions";

// Field team logins (spec v0.8 item 6). Each person gets their own login. Creating an
// account needs the secret key (Supabase Auth admin API); only a verified admin gets here.
// The person then signs in on the normal login page with an email link.

const BAN = "876000h"; // about 100 years: access off until switched back on

export async function addFieldUser(email: string, fullName: string): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const addr = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return { ok: false, message: "Enter a valid email address." };
  const admin = createServiceClient();

  const { data: created, error } = await admin.auth.admin.createUser({ email: addr, email_confirm: true });
  if (error || !created.user) {
    return { ok: false, message: error?.message.includes("already") ? "That email already has a portal login." : `Couldn't create the login: ${error?.message}` };
  }
  const { error: pErr } = await admin.from("profiles").insert({ id: created.user.id, role: "field_team", full_name: fullName.trim() || null });
  if (pErr) {
    await admin.auth.admin.deleteUser(created.user.id); // nothing else references a brand-new user
    return { ok: false, message: `Couldn't save the profile: ${pErr.message}` };
  }
  const supabase = await createClient();
  await supabase.from("audit_log").insert({ actor: viewer.userId, action: "field_user.add", entity: "profiles", entity_id: created.user.id, meta: { email: addr } });
  revalidatePath("/field-team");
  return { ok: true, message: `Added. ${addr} can now sign in at the portal's login page with an email link.` };
}

export async function setFieldUserAccess(userId: string, on: boolean): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const admin = createServiceClient();
  const { data: profile } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (profile?.role !== "field_team") return { ok: false, message: "Only field team logins can be changed here." };
  const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: on ? "none" : BAN });
  if (error) return { ok: false, message: error.message };
  const supabase = await createClient();
  await supabase.from("audit_log").insert({ actor: viewer.userId, action: on ? "field_user.on" : "field_user.off", entity: "profiles", entity_id: userId });
  revalidatePath("/field-team");
  return { ok: true, message: on ? "Access switched on." : "Access switched off." };
}
