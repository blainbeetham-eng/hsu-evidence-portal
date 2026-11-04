"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/dal";
import { matchProperty } from "@/lib/address-key";
import type { ActionResult } from "../properties/[id]/actions";

export type Found = { propertyId: string; address: string; workOrders: { id: string; label: string }[] } | null;

/** Find a property (and its work orders) from an address typed or pasted by Blain. */
export async function findProperty(address: string): Promise<Found> {
  await requireAdmin();
  const supabase = await createClient();
  const { data: props } = await supabase.from("properties").select("id, address").is("removed_at", null);
  const p = matchProperty(address, props ?? []);
  if (!p) return null;
  const { data: wos } = await supabase
    .from("work_orders").select("id, activity_type, source_order_ref").eq("property_id", p.id).is("removed_at", null).order("activity_type");
  return {
    propertyId: p.id,
    address: p.address,
    workOrders: (wos ?? []).map((w) => ({ id: w.id, label: `${w.activity_type ?? "Work order"}${w.source_order_ref ? ` (${w.source_order_ref})` : ""}` })),
  };
}

/** File an emailed batch to a work order. Its files stay "waiting for review". */
export async function fileInboxItem(itemId: string, workOrderId: string): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const supabase = await createClient();
  const { data: wo } = await supabase.from("work_orders").select("id, property_id").eq("id", workOrderId).maybeSingle();
  if (!wo) return { ok: false, message: "Work order not found." };
  const { error } = await supabase.from("evidence_files").update({ work_order_id: workOrderId }).eq("inbox_item_id", itemId).is("deleted_at", null);
  if (error) return { ok: false, message: error.message };
  await supabase.from("inbox_items").update({
    status: "filed", filed_work_order_id: workOrderId, filed_by: viewer.userId, filed_at: new Date().toISOString(),
  }).eq("id", itemId);
  await supabase.from("audit_log").insert({ actor: viewer.userId, action: "inbox.file", entity: "inbox_items", entity_id: itemId, meta: { workOrderId } });
  revalidatePath("/inbox");
  revalidatePath("/review");
  revalidatePath(`/properties/${wo.property_id}`);
  return { ok: true, message: "Filed. Review the files on the property page." };
}

export async function discardInboxItem(itemId: string, reason: string): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const supabase = await createClient();
  if (!reason.trim()) return { ok: false, message: "Give a reason." };
  const now = new Date().toISOString();
  await supabase.from("evidence_files").update({ deleted_at: now, delete_reason: `Inbox: ${reason.trim()}` })
    .eq("inbox_item_id", itemId).is("work_order_id", null).is("deleted_at", null);
  const { error } = await supabase.from("inbox_items").update({ status: "discarded", discard_reason: reason.trim() }).eq("id", itemId);
  if (error) return { ok: false, message: error.message };
  await supabase.from("audit_log").insert({ actor: viewer.userId, action: "inbox.discard", entity: "inbox_items", entity_id: itemId, meta: { reason } });
  revalidatePath("/inbox");
  return { ok: true, message: "Discarded (kept in the history)." };
}
