"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/dal";
import { runSync } from "@/lib/sync/run-sync";
import { supabaseStore } from "@/lib/sync/supabase-store";
import { serverEnv } from "@/lib/env";

export async function syncNow() {
  const viewer = await requireAdmin();
  const service = createServiceClient();
  await service.from("audit_log").insert({ actor: viewer.userId, action: "sync.manual" });
  await runSync({
    trigger: "manual",
    triggeredBy: viewer.userId,
    token: serverEnv.airtableToken(),
    store: supabaseStore(service),
  });
  revalidatePath("/", "layout");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
