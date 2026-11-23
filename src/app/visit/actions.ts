"use server";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/dal";
import { QUOTE_PHOTO_KEY, cleanValues, mergeQuoteDetails, quoteDefFor, quoteKind } from "@/lib/quote-visit";

// Quote visit actions (admin only). Admin's own session, so RLS applies.

export type VisitResult = { ok: boolean; message: string };
type Supabase = Awaited<ReturnType<typeof createClient>>;

const PHOTO_MIMES = new Set(["image/jpeg", "image/png", "image/heic", "image/heif", "image/webp"]);
const MAX_BYTES = 30 * 1024 * 1024;

async function workOrder(supabase: Supabase, workOrderId: string) {
  const { data } = await supabase.from("work_orders").select("id, property_id, activity_type, removed_at").eq("id", workOrderId).maybeSingle();
  if (!data || data.removed_at) return null;
  const def = quoteDefFor(data.activity_type);
  return def ? { ...data, def } : null;
}

async function audit(supabase: Supabase, actor: string, action: string, entity: string, entityId: string, meta = {}) {
  await supabase.from("audit_log").insert({ actor, action, entity, entity_id: entityId, meta });
}

const done = (propertyId: string, message = "Saved."): VisitResult => {
  revalidatePath(`/visit/${propertyId}`);
  revalidatePath(`/properties/${propertyId}`);
  return { ok: true, message };
};

export async function addQuoteItem(workOrderId: string, kind: string, label: string): Promise<VisitResult> {
  const viewer = await requireAdmin();
  const supabase = await createClient();
  const wo = await workOrder(supabase, workOrderId);
  if (!wo || !quoteKind(wo.def, kind)) return { ok: false, message: "Pick what you're adding." };
  if (!label.trim()) return { ok: false, message: "Give it a name, e.g. Front door or Bedroom 1 window." };
  const { error } = await supabase.from("job_items").insert({
    work_order_id: workOrderId, template: wo.def.id, kind, label: label.trim().slice(0, 80), created_by: viewer.userId,
  });
  if (error) return { ok: false, message: error.message };
  return done(wo.property_id, "Added.");
}

export async function saveQuoteItem(workOrderId: string, itemId: string, values: Record<string, string>, label: string): Promise<VisitResult> {
  await requireAdmin();
  const supabase = await createClient();
  const wo = await workOrder(supabase, workOrderId);
  const { data: item } = await supabase.from("job_items").select("kind, work_order_id, details").eq("id", itemId).maybeSingle();
  const k = wo && item && item.work_order_id === workOrderId ? quoteKind(wo.def, item.kind) : undefined;
  if (!wo || !k) return { ok: false, message: "Item not found." };
  const details = mergeQuoteDetails(item!.details as Record<string, string> | null, cleanValues(k.fields, values));
  const update: { details: Record<string, string>; label?: string } = { details };
  if (label.trim()) update.label = label.trim().slice(0, 80);
  const { error } = await supabase.from("job_items").update(update).eq("id", itemId);
  if (error) return { ok: false, message: error.message };
  return done(wo.property_id);
}

export async function removeQuoteItem(workOrderId: string, itemId: string): Promise<VisitResult> {
  await requireAdmin();
  const supabase = await createClient();
  const wo = await workOrder(supabase, workOrderId);
  if (!wo) return { ok: false, message: "Job not found." };
  const { error } = await supabase.from("job_items").update({ removed_at: new Date().toISOString() }).eq("id", itemId).eq("work_order_id", workOrderId);
  if (error) return { ok: false, message: error.message };
  return done(wo.property_id, "Removed.");
}

export async function saveQuoteAnswers(workOrderId: string, values: Record<string, string>): Promise<VisitResult> {
  const viewer = await requireAdmin();
  const supabase = await createClient();
  const wo = await workOrder(supabase, workOrderId);
  if (!wo) return { ok: false, message: "Job not found." };
  const { error } = await supabase.from("quote_visits").upsert({
    work_order_id: workOrderId, template: wo.def.id, template_version: wo.def.version,
    answers: cleanValues(wo.def.jobFields, values), updated_by: viewer.userId, updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, message: error.message };
  return done(wo.property_id);
}

export type QuotePhoto = {
  workOrderId: string; path: string; fileName: string; mime: string; size: number; sha256: string;
  capturedAt: string; lat: number | null; lng: number | null; accuracyM: number | null; jobItemId: string | null;
};

/** Record a photo the phone has just uploaded to Storage. Hidden from landlords and agencies. */
export async function recordQuotePhoto(c: QuotePhoto): Promise<VisitResult> {
  const viewer = await requireAdmin();
  const supabase = await createClient();
  const wo = await workOrder(supabase, c.workOrderId);
  if (!wo) return { ok: false, message: "Job not found." };
  if (!PHOTO_MIMES.has(c.mime) || c.size > MAX_BYTES) return { ok: false, message: "Only photos up to 30 MB." };
  if (!c.path.startsWith(`${c.workOrderId}/`) || !/^[0-9a-f]{64}$/.test(c.sha256)) return { ok: false, message: "Upload details didn't check out." };
  if (c.jobItemId) {
    const { data: item } = await supabase.from("job_items").select("work_order_id").eq("id", c.jobItemId).maybeSingle();
    if (!item || item.work_order_id !== c.workOrderId) return { ok: false, message: "That item isn't on this job." };
  }

  // A retry after the row was saved: nothing more to do.
  const { data: existing } = await supabase.from("evidence_files").select("id").eq("storage_path", c.path).maybeSingle();
  if (existing) return { ok: true, message: "Saved." };

  const { data: blob } = await supabase.storage.from("evidence").download(c.path);
  const stored = blob ? createHash("sha256").update(Buffer.from(await blob.arrayBuffer())).digest("hex") : null;
  if (stored !== c.sha256) return { ok: false, message: "The photo didn't arrive intact. It will try again." };

  const captured = new Date(c.capturedAt);
  const flags: string[] = [];
  if (c.lat === null || c.lng === null) flags.push("no_location");
  else if ((c.accuracyM ?? 0) > 50) flags.push("low_accuracy");

  const { data: row, error } = await supabase.from("evidence_files").insert({
    work_order_id: c.workOrderId, kind: "photo", stage: "assessment", storage_path: c.path, file_name: c.fileName,
    mime: c.mime, size_bytes: c.size, sha256: c.sha256, source: "admin_upload", hidden: true,
    job_item_id: c.jobItemId, checklist_key: QUOTE_PHOTO_KEY,
    taken_at: Number.isNaN(captured.getTime()) ? null : captured.toISOString(),
    lat: c.lat, lng: c.lng, accuracy_m: c.accuracyM, geo_source: c.lat === null ? "none" : "browser", flags,
    uploaded_by: viewer.userId,
  }).select("id").single();
  if (error) return { ok: false, message: `Couldn't save the photo: ${error.message}` };
  await audit(supabase, viewer.userId, "quote.photo", "evidence_files", row.id);
  return done(wo.property_id);
}

export async function removeQuotePhoto(propertyId: string, fileId: string): Promise<VisitResult> {
  const viewer = await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.from("evidence_files")
    .update({ deleted_at: new Date().toISOString(), delete_reason: "Removed from quote visit" })
    .eq("id", fileId).eq("checklist_key", QUOTE_PHOTO_KEY).is("deleted_at", null).select("id");
  if (error) return { ok: false, message: error.message };
  if (!data?.length) return { ok: false, message: "Photo not found." };
  await audit(supabase, viewer.userId, "quote.photo_remove", "evidence_files", fileId);
  return done(propertyId, "Removed.");
}
