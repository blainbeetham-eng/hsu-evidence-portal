"use server";
import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/dal";
import { driveClient, driveFolderId, driveTakenAt } from "@/lib/drive";
import { PROMPT_VERSION, summariseReport } from "@/lib/summary";

// Assessment-stage actions (spec v0.7). Every write uses the admin's own session,
// so the database's RLS rules apply; nothing here uses the secret key.

type Supabase = Awaited<ReturnType<typeof createClient>>;
export type ActionResult = { ok: boolean; message: string };

const KIND_BY_MIME: Record<string, "report" | "photo" | "video"> = {
  "application/pdf": "report",
  "image/jpeg": "photo",
  "image/png": "photo",
  "image/heic": "photo",
  "image/heif": "photo",
  "image/webp": "photo",
  "video/mp4": "video",
  "video/quicktime": "video",
};
// Drive import runs on the server, so large videos are uploaded from the browser instead.
const DRIVE_IMPORT_MAX_BYTES = 100 * 1024 * 1024;
// Uploads up to this size are re-hashed on the server to check the browser's hash.
const VERIFY_MAX_BYTES = 60 * 1024 * 1024;

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const safeName = (name: string) => name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120);

async function audit(supabase: Supabase, actor: string, action: string, entity: string, entityId: string, meta = {}) {
  await supabase.from("audit_log").insert({ actor, action, entity, entity_id: entityId, meta });
}

/** Summarise a stored report and save the result as a new draft version. */
async function draftSummary(supabase: Supabase, actor: string, reportId: string): Promise<ActionResult> {
  const { data: report } = await supabase
    .from("evidence_files")
    .select("id, storage_path, sha256, kind")
    .eq("id", reportId)
    .maybeSingle();
  if (!report || report.kind !== "report") return { ok: false, message: "Report not found." };

  const { data: blob, error } = await supabase.storage.from("evidence").download(report.storage_path);
  if (error || !blob) return { ok: false, message: `Couldn't open the report: ${error?.message}` };

  let result;
  try {
    result = await summariseReport(Buffer.from(await blob.arrayBuffer()));
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "The AI summary failed." };
  }

  const { data: last } = await supabase
    .from("report_summaries")
    .select("version")
    .eq("report_id", reportId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error: insertError } = await supabase.from("report_summaries").insert({
    report_id: reportId,
    version: (last?.version ?? 0) + 1,
    body: result.summary,
    source: "ai",
    model: result.model,
    prompt_version: PROMPT_VERSION,
    report_sha256: report.sha256,
    created_by: actor,
  });
  if (insertError) return { ok: false, message: `Couldn't save the summary: ${insertError.message}` };
  if (result.di_report_url) {
    await supabase.from("report_extras").upsert({ report_id: reportId, di_report_url: result.di_report_url });
  }
  await audit(supabase, actor, "summary.draft", "evidence_files", reportId, { model: result.model });
  return { ok: true, message: "Summary drafted." };
}

export async function importFromDrive(propertyId: string, workOrderId: string): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const supabase = await createClient();

  const { data: wo } = await supabase
    .from("work_orders")
    .select("id, property_id, drive_folder_url")
    .eq("id", workOrderId)
    .maybeSingle();
  if (!wo || wo.property_id !== propertyId) return { ok: false, message: "Work order not found." };
  const folderId = wo.drive_folder_url ? driveFolderId(wo.drive_folder_url) : null;
  if (!folderId) return { ok: false, message: "This work order has no Drive folder link in Airtable." };

  let drive, listed;
  try {
    drive = await driveClient();
    listed = await drive.list(folderId);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn't read the Drive folder." };
  }

  const { data: existing } = await supabase
    .from("evidence_files")
    .select("drive_file_id")
    .in("drive_file_id", listed.map((f) => f.id));
  const already = new Set((existing ?? []).map((r) => r.drive_file_id));

  let added = 0;
  const skipped: string[] = [];
  const newReports: string[] = [];
  for (const f of listed) {
    if (already.has(f.id)) continue;
    const kind = KIND_BY_MIME[f.mimeType];
    if (!kind) { skipped.push(`${f.name} (file type not used)`); continue; }
    if (Number(f.size ?? 0) > DRIVE_IMPORT_MAX_BYTES) { skipped.push(`${f.name} (too large; upload it instead)`); continue; }

    const body = await drive.download(f.id);
    const path = `${workOrderId}/${randomUUID()}-${safeName(f.name)}`;
    const { error: upErr } = await supabase.storage.from("evidence").upload(path, body, { contentType: f.mimeType, upsert: false });
    if (upErr) { skipped.push(`${f.name} (${upErr.message})`); continue; }

    const { data: row, error: rowErr } = await supabase
      .from("evidence_files")
      .insert({
        work_order_id: workOrderId,
        kind,
        storage_path: path,
        file_name: f.name,
        mime: f.mimeType,
        size_bytes: body.length,
        sha256: sha256(body),
        source: "drive_import",
        drive_file_id: f.id,
        taken_at: driveTakenAt(f),
        uploaded_by: viewer.userId,
      })
      .select("id")
      .single();
    if (rowErr) { skipped.push(`${f.name} (${rowErr.message})`); continue; }
    added += 1;
    if (kind === "report") newReports.push(row.id);
  }

  await audit(supabase, viewer.userId, "drive.import", "work_orders", workOrderId, { added, skipped: skipped.length });
  const notes: string[] = [];
  for (const id of newReports) {
    const r = await draftSummary(supabase, viewer.userId, id);
    if (!r.ok) notes.push(r.message);
  }
  revalidatePath(`/properties/${propertyId}`);

  const parts = [added === 0 ? "No new files to import." : `Imported ${added} file${added === 1 ? "" : "s"}.`];
  if (newReports.length) parts.push(notes.length ? `Summary not drafted: ${notes.join(" ")}` : "Report summary drafted for review.");
  if (skipped.length) parts.push(`Skipped: ${skipped.join("; ")}.`);
  return { ok: true, message: parts.join(" ") };
}

export type UploadRecord = {
  propertyId: string;
  workOrderId: string;
  path: string;
  posterPath: string | null;
  fileName: string;
  mime: string;
  size: number;
  sha256: string;
  takenAt: string | null;
  durationS: number | null;
};

/** Called after the browser has uploaded a file straight to Storage. */
export async function recordUpload(u: UploadRecord): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const supabase = await createClient();
  const kind = KIND_BY_MIME[u.mime];
  if (!kind) return { ok: false, message: "That file type isn't accepted." };
  if (!u.path.startsWith(`${u.workOrderId}/`) || !/^[0-9a-f]{64}$/.test(u.sha256)) {
    return { ok: false, message: "Upload details didn't check out." };
  }
  const { data: wo } = await supabase.from("work_orders").select("property_id").eq("id", u.workOrderId).maybeSingle();
  if (!wo || wo.property_id !== u.propertyId) return { ok: false, message: "Work order not found." };

  if (u.size <= VERIFY_MAX_BYTES) {
    const { data: blob, error } = await supabase.storage.from("evidence").download(u.path);
    if (error || !blob) return { ok: false, message: "The uploaded file couldn't be found in storage." };
    if (sha256(Buffer.from(await blob.arrayBuffer())) !== u.sha256) {
      return { ok: false, message: "The stored file doesn't match what was uploaded. Please upload it again." };
    }
  }

  const { data: row, error } = await supabase
    .from("evidence_files")
    .insert({
      work_order_id: u.workOrderId,
      kind,
      storage_path: u.path,
      poster_path: u.posterPath,
      file_name: u.fileName,
      mime: u.mime,
      size_bytes: u.size,
      sha256: u.sha256,
      source: "admin_upload",
      taken_at: u.takenAt,
      duration_s: u.durationS,
      uploaded_by: viewer.userId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, message: `Couldn't record the upload: ${error.message}` };
  await audit(supabase, viewer.userId, "file.upload", "evidence_files", row.id, { kind });

  let message = "Uploaded.";
  if (kind === "report") {
    const r = await draftSummary(supabase, viewer.userId, row.id);
    message = r.ok ? "Uploaded. Report summary drafted for review." : `Uploaded. Summary not drafted: ${r.message}`;
  }
  revalidatePath(`/properties/${u.propertyId}`);
  return { ok: true, message };
}

export async function regenerateSummary(propertyId: string, reportId: string): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const supabase = await createClient();
  const result = await draftSummary(supabase, viewer.userId, reportId);
  revalidatePath(`/properties/${propertyId}`);
  return result;
}

export async function approveSummary(propertyId: string, summaryId: string): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const supabase = await createClient();
  const { data: s } = await supabase.from("report_summaries").select("id, report_id").eq("id", summaryId).maybeSingle();
  if (!s) return { ok: false, message: "Summary not found." };
  await supabase.from("report_summaries").update({ status: "superseded" }).eq("report_id", s.report_id).eq("status", "approved");
  const { error } = await supabase
    .from("report_summaries")
    .update({ status: "approved", approved_by: viewer.userId, approved_at: new Date().toISOString() })
    .eq("id", summaryId);
  if (error) return { ok: false, message: error.message };
  await audit(supabase, viewer.userId, "summary.approve", "report_summaries", summaryId);
  revalidatePath(`/properties/${propertyId}`);
  return { ok: true, message: "Approved. Landlord and agency will see this summary." };
}

export async function hideSummary(propertyId: string, summaryId: string): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("report_summaries").update({ status: "hidden" }).eq("id", summaryId);
  if (error) return { ok: false, message: error.message };
  await audit(supabase, viewer.userId, "summary.hide", "report_summaries", summaryId);
  revalidatePath(`/properties/${propertyId}`);
  return { ok: true, message: "Summary hidden." };
}

export async function editSummary(propertyId: string, summaryId: string, body: string): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const supabase = await createClient();
  const text = body.trim();
  if (!text) return { ok: false, message: "The summary can't be empty." };
  const { data: s } = await supabase
    .from("report_summaries")
    .select("report_id, model, prompt_version, report_sha256")
    .eq("id", summaryId)
    .maybeSingle();
  if (!s) return { ok: false, message: "Summary not found." };
  const { data: last } = await supabase
    .from("report_summaries")
    .select("version")
    .eq("report_id", s.report_id)
    .order("version", { ascending: false })
    .limit(1)
    .single();
  // An edit is a new draft version; the AI's original stays in the history.
  const { error } = await supabase.from("report_summaries").insert({
    report_id: s.report_id,
    version: (last?.version ?? 0) + 1,
    body: text,
    source: "manual",
    model: s.model,
    prompt_version: s.prompt_version,
    report_sha256: s.report_sha256,
    created_by: viewer.userId,
  });
  if (error) return { ok: false, message: error.message };
  await audit(supabase, viewer.userId, "summary.edit", "evidence_files", s.report_id);
  revalidatePath(`/properties/${propertyId}`);
  return { ok: true, message: "Saved as a new draft. Approve it to publish." };
}

export async function setFileHidden(propertyId: string, fileId: string, hidden: boolean): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("evidence_files").update({ hidden }).eq("id", fileId);
  if (error) return { ok: false, message: error.message };
  await audit(supabase, viewer.userId, hidden ? "file.hide" : "file.show", "evidence_files", fileId);
  revalidatePath(`/properties/${propertyId}`);
  return { ok: true, message: hidden ? "Hidden from landlord and agency." : "Visible to landlord and agency." };
}
