"use server";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireFieldUser } from "@/lib/dal";
import { TEMPLATES, itemKind, templateFor } from "@/lib/checklists";

// Field team actions (spec v0.8 item 6, Section 5). The signed-in person's own session,
// so RLS decides: they can only touch jobs given to the field team, and photos go in as
// drafts until they submit.

export type FieldResult = { ok: boolean; message: string };
type Supabase = Awaited<ReturnType<typeof createClient>>;

const PHOTO_MIMES = new Set(["image/jpeg", "image/png", "image/heic", "image/heif", "image/webp"]);
const MAX_BYTES = 30 * 1024 * 1024;

async function job(supabase: Supabase, workOrderId: string) {
  const { data } = await supabase.rpc("field_jobs");
  const j = (data ?? []).find((r: { work_order_id: string }) => r.work_order_id === workOrderId) as
    | { work_order_id: string; activity_type: string | null }
    | undefined;
  return j ? { ...j, template: templateFor(j.activity_type) } : null;
}

export type Capture = {
  workOrderId: string;
  path: string;
  fileName: string;
  mime: string;
  size: number;
  sha256: string;
  capturedAt: string; // device clock at capture (untrusted; server time is created_at)
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  jobItemId: string | null;
  slotKey: string;
};

/** Record a photo the phone has just uploaded to Storage. */
export async function recordCapture(c: Capture): Promise<FieldResult> {
  const viewer = await requireFieldUser();
  const supabase = await createClient();
  const j = await job(supabase, c.workOrderId);
  if (!j?.template) return { ok: false, message: "This job isn't on your list any more." };
  if (!PHOTO_MIMES.has(c.mime) || c.size > MAX_BYTES) return { ok: false, message: "Only photos up to 30 MB." };
  if (!c.path.startsWith(`${c.workOrderId}/`) || !/^[0-9a-f]{64}$/.test(c.sha256)) return { ok: false, message: "Upload details didn't check out." };

  // The slot must exist in the template (for an item, in that item's kind).
  let phase: string | undefined;
  if (c.jobItemId) {
    const { data: item } = await supabase.from("job_items").select("kind, work_order_id").eq("id", c.jobItemId).maybeSingle();
    if (!item || item.work_order_id !== c.workOrderId) return { ok: false, message: "That item isn't on this job." };
    phase = itemKind(j.template, item.kind)?.slots.find((s) => s.key === c.slotKey)?.phase;
  } else {
    phase = j.template.jobSlots.find((s) => s.key === c.slotKey)?.phase;
  }
  if (!phase) return { ok: false, message: "Unknown photo slot." };

  const captured = new Date(c.capturedAt);
  const flags: string[] = [];
  if (c.lat === null || c.lng === null) flags.push("no_location");
  else if ((c.accuracyM ?? 0) > 50) flags.push("low_accuracy");
  if (Number.isNaN(captured.getTime()) || Date.now() - captured.getTime() > 24 * 3600 * 1000) flags.push("old_capture");

  const { data: row, error } = await supabase
    .from("evidence_files")
    .insert({
      work_order_id: c.workOrderId,
      kind: "photo",
      stage: "works",
      storage_path: c.path,
      file_name: c.fileName,
      mime: c.mime,
      size_bytes: c.size,
      sha256: c.sha256,
      source: "field_capture",
      review_status: "draft",
      phase,
      job_item_id: c.jobItemId,
      checklist_key: c.slotKey,
      taken_at: Number.isNaN(captured.getTime()) ? null : captured.toISOString(),
      lat: c.lat,
      lng: c.lng,
      accuracy_m: c.accuracyM,
      geo_source: c.lat === null ? "none" : "browser",
      flags,
      uploaded_by: viewer.userId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, message: `Couldn't save the photo: ${error.message}` };

  // Check the stored file is the one the phone hashed (spec 5.4).
  const { data: blob } = await supabase.storage.from("evidence").download(c.path);
  const stored = blob ? createHash("sha256").update(Buffer.from(await blob.arrayBuffer())).digest("hex") : null;
  if (stored !== c.sha256) {
    await supabase.rpc("discard_field_photo", { p_file_id: row.id });
    return { ok: false, message: "The photo didn't arrive intact. It will try again." };
  }
  revalidatePath(`/field/${c.workOrderId}`);
  return { ok: true, message: "Saved." };
}

export async function addItem(workOrderId: string, kind: string, label: string): Promise<FieldResult> {
  const viewer = await requireFieldUser();
  const supabase = await createClient();
  const j = await job(supabase, workOrderId);
  if (!j?.template || !itemKind(j.template, kind)) return { ok: false, message: "Pick what you're adding." };
  if (!label.trim()) return { ok: false, message: "Give it a name, e.g. Front door or Bedroom 1 window." };
  const { error } = await supabase.from("job_items").insert({
    work_order_id: workOrderId, template: j.template.id, kind, label: label.trim().slice(0, 80), created_by: viewer.userId,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/field/${workOrderId}`);
  return { ok: true, message: "Added." };
}

export async function saveItemDetails(workOrderId: string, itemId: string, details: Record<string, string>): Promise<FieldResult> {
  await requireFieldUser();
  const supabase = await createClient();
  const j = await job(supabase, workOrderId);
  const { data: item } = await supabase.from("job_items").select("kind, work_order_id").eq("id", itemId).maybeSingle();
  if (!j?.template || !item || item.work_order_id !== workOrderId) return { ok: false, message: "Item not found." };
  const fields = itemKind(j.template, item.kind)?.fields ?? [];
  const clean = Object.fromEntries(fields.flatMap((f) => (details[f.key] ? [[f.key, String(details[f.key]).slice(0, 300)]] : [])));
  const { data, error } = await supabase.from("job_items").update({ details: clean }).eq("id", itemId).select("id");
  if (error) return { ok: false, message: error.message };
  if (!data?.length) return { ok: false, message: "This item is locked: HSU has accepted its photos." };
  revalidatePath(`/field/${workOrderId}`);
  return { ok: true, message: "Saved." };
}

export async function removeItem(workOrderId: string, itemId: string): Promise<FieldResult> {
  await requireFieldUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("job_items").update({ removed_at: new Date().toISOString() }).eq("id", itemId).eq("work_order_id", workOrderId).select("id");
  if (error) return { ok: false, message: error.message };
  if (!data?.length) return { ok: false, message: "This item is locked: HSU has accepted its photos." };
  revalidatePath(`/field/${workOrderId}`);
  return { ok: true, message: "Removed." };
}

export async function saveAnswers(workOrderId: string, answers: Record<string, string>): Promise<FieldResult> {
  const viewer = await requireFieldUser();
  const supabase = await createClient();
  const j = await job(supabase, workOrderId);
  if (!j?.template) return { ok: false, message: "This job isn't on your list any more." };
  const t = TEMPLATES[j.template.id];
  const clean = Object.fromEntries(t.questions.flatMap((q) => (answers[q.key] ? [[q.key, String(answers[q.key]).slice(0, 1000)]] : [])));
  const { error } = await supabase.from("job_checklists").upsert({
    work_order_id: workOrderId, template: t.id, template_version: t.version, answers: clean,
    updated_by: viewer.userId, updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/field/${workOrderId}`);
  return { ok: true, message: "Saved." };
}

export async function discardPhoto(workOrderId: string, fileId: string): Promise<FieldResult> {
  await requireFieldUser();
  const supabase = await createClient();
  const { data } = await supabase.rpc("discard_field_photo", { p_file_id: fileId });
  revalidatePath(`/field/${workOrderId}`);
  return data ? { ok: true, message: "Removed." } : { ok: false, message: "Only photos not yet submitted can be removed." };
}

export async function submitJob(workOrderId: string): Promise<FieldResult> {
  await requireFieldUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_field_job", { p_work_order_id: workOrderId });
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/field/${workOrderId}`);
  revalidatePath("/review");
  const n = Number(data ?? 0);
  return n
    ? { ok: true, message: `Sent ${n} photo${n === 1 ? "" : "s"} to HSU for review. Thanks!` }
    : { ok: false, message: "No new photos to send." };
}
