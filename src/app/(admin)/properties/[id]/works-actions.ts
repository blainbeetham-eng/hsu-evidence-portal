"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/dal";
import { COMPLIANCE_STATUSES } from "@/lib/checklists";
import type { ActionResult } from "./actions";

// Works and Completion stage actions (spec v0.8, Phase 2B). Admin's own session, so RLS
// applies. Nothing is deleted: summaries get new versions, notes are soft-deleted.

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function audit(supabase: Supabase, actor: string, action: string, entity: string, entityId: string, meta = {}) {
  await supabase.from("audit_log").insert({ actor, action, entity, entity_id: entityId, meta });
}

async function woOnProperty(supabase: Supabase, propertyId: string, workOrderId: string) {
  const { data } = await supabase.from("work_orders").select("id, property_id").eq("id", workOrderId).maybeSingle();
  return data?.property_id === propertyId;
}

export async function setFieldAssignment(propertyId: string, workOrderId: string, assign: boolean): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const supabase = await createClient();
  if (!(await woOnProperty(supabase, propertyId, workOrderId))) return { ok: false, message: "Work order not found." };
  const { error } = await supabase.from("field_assignments").upsert({
    work_order_id: workOrderId,
    assigned_by: viewer.userId,
    assigned_at: new Date().toISOString(),
    ended_at: assign ? null : new Date().toISOString(),
  });
  if (error) return { ok: false, message: error.message };
  await audit(supabase, viewer.userId, assign ? "field.assign" : "field.unassign", "work_orders", workOrderId);
  revalidatePath(`/properties/${propertyId}`);
  return { ok: true, message: assign ? "On the field team's job list." : "Removed from the field team's job list." };
}

export async function reviewFiles(
  propertyId: string,
  fileIds: string[],
  decision: "accepted" | "needs_more" | "rejected",
  note: string,
): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const supabase = await createClient();
  if (!fileIds.length) return { ok: false, message: "Nothing selected." };
  if (decision !== "accepted" && !note.trim()) {
    return { ok: false, message: decision === "rejected" ? "Say why it's rejected." : "Say what's missing." };
  }
  const { data, error } = await supabase
    .from("evidence_files")
    .update({ review_status: decision, review_note: note.trim() || null, reviewed_by: viewer.userId, reviewed_at: new Date().toISOString() })
    .in("id", fileIds)
    .not("work_order_id", "is", null)
    .select("id");
  if (error) return { ok: false, message: error.message };
  for (const f of data ?? []) await audit(supabase, viewer.userId, `review.${decision}`, "evidence_files", f.id, { note });
  revalidatePath(`/properties/${propertyId}`);
  revalidatePath("/review");
  const n = data?.length ?? 0;
  const what = decision === "accepted" ? "Accepted: landlord and agency will see" : decision === "needs_more" ? "Asked for more on" : "Rejected";
  return { ok: true, message: `${what} ${n} file${n === 1 ? "" : "s"}.` };
}

/** Move a file to a checklist slot or another phase (admin uploads and emailed photos). */
export async function fileToSlot(
  propertyId: string,
  fileId: string,
  phase: "before" | "during" | "after" | null,
  jobItemId: string | null,
  checklistKey: string | null,
): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("evidence_files")
    .update({ phase, job_item_id: jobItemId, checklist_key: checklistKey })
    .eq("id", fileId);
  if (error) return { ok: false, message: error.message };
  await audit(supabase, viewer.userId, "file.slot", "evidence_files", fileId, { phase, jobItemId, checklistKey });
  revalidatePath(`/properties/${propertyId}`);
  return { ok: true, message: "Filed." };
}

export async function setUpgradeStatus(
  propertyId: string,
  workOrderId: string,
  status: string,
  exemptionGround: string,
  note: string,
): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const supabase = await createClient();
  if (!COMPLIANCE_STATUSES.some((s) => s.value === status)) return { ok: false, message: "Pick a status." };
  if (status === "exempt_recorded" && !exemptionGround.trim()) return { ok: false, message: "Record the exemption ground." };
  if (!(await woOnProperty(supabase, propertyId, workOrderId))) return { ok: false, message: "Work order not found." };
  const { error } = await supabase.from("upgrade_status").insert({
    work_order_id: workOrderId,
    status,
    exemption_ground: exemptionGround.trim() || null,
    note: note.trim() || null,
    set_by: viewer.userId,
  });
  if (error) return { ok: false, message: error.message };
  await audit(supabase, viewer.userId, "status.set", "work_orders", workOrderId, { status });
  revalidatePath(`/properties/${propertyId}`);
  return { ok: true, message: "Status saved. Landlord and agency see it on the page." };
}

export async function saveSummary(
  propertyId: string,
  kind: "works" | "completion",
  workOrderId: string | null,
  body: string,
): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const supabase = await createClient();
  const text = body.trim();
  if (!text) return { ok: false, message: "Write something first." };
  if ((kind === "works") !== (workOrderId !== null)) return { ok: false, message: "Summary target didn't check out." };
  if (workOrderId && !(await woOnProperty(supabase, propertyId, workOrderId))) return { ok: false, message: "Work order not found." };

  let q = supabase.from("written_summaries").select("version").eq("property_id", propertyId).eq("kind", kind);
  q = workOrderId ? q.eq("work_order_id", workOrderId) : q.is("work_order_id", null);
  const { data: last } = await q.order("version", { ascending: false }).limit(1).maybeSingle();

  const { data, error } = await supabase
    .from("written_summaries")
    .insert({ property_id: propertyId, work_order_id: workOrderId, kind, version: (last?.version ?? 0) + 1, body: text, written_by: viewer.userId })
    .select("id")
    .single();
  if (error) return { ok: false, message: error.message };
  await audit(supabase, viewer.userId, "written_summary.save", "written_summaries", data.id, { kind });
  revalidatePath(`/properties/${propertyId}`);
  return { ok: true, message: "Saved as a draft. Publish it when ready." };
}

export async function publishSummary(propertyId: string, summaryId: string): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const supabase = await createClient();
  const { data: s } = await supabase
    .from("written_summaries")
    .select("id, property_id, work_order_id, kind")
    .eq("id", summaryId)
    .maybeSingle();
  if (!s || s.property_id !== propertyId) return { ok: false, message: "Summary not found." };
  let q = supabase.from("written_summaries").update({ status: "superseded" }).eq("property_id", propertyId).eq("kind", s.kind).eq("status", "published");
  q = s.work_order_id ? q.eq("work_order_id", s.work_order_id) : q.is("work_order_id", null);
  await q;
  const { error } = await supabase
    .from("written_summaries")
    .update({ status: "published", published_by: viewer.userId, published_at: new Date().toISOString() })
    .eq("id", summaryId);
  if (error) return { ok: false, message: error.message };
  await audit(supabase, viewer.userId, "written_summary.publish", "written_summaries", summaryId);
  revalidatePath(`/properties/${propertyId}`);
  return { ok: true, message: "Published. Landlord and agency see this version." };
}

export async function addNote(propertyId: string, workOrderId: string | null, body: string, visibility: string): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const supabase = await createClient();
  if (!body.trim()) return { ok: false, message: "Write the note first." };
  if (!["internal", "agency", "agency_landlord"].includes(visibility)) return { ok: false, message: "Pick who can see it." };
  if (workOrderId && !(await woOnProperty(supabase, propertyId, workOrderId))) return { ok: false, message: "Work order not found." };
  const { data, error } = await supabase
    .from("notes")
    .insert({ property_id: propertyId, work_order_id: workOrderId, body: body.trim(), visibility, author: viewer.userId })
    .select("id")
    .single();
  if (error) return { ok: false, message: error.message };
  await audit(supabase, viewer.userId, "note.add", "notes", data.id, { visibility });
  revalidatePath(`/properties/${propertyId}`);
  return { ok: true, message: "Note added." };
}

export async function removeNote(propertyId: string, noteId: string, reason: string): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const supabase = await createClient();
  if (!reason.trim()) return { ok: false, message: "Give a reason for removing it." };
  const { error } = await supabase
    .from("notes")
    .update({ deleted_at: new Date().toISOString(), delete_reason: reason.trim() })
    .eq("id", noteId)
    .eq("property_id", propertyId);
  if (error) return { ok: false, message: error.message };
  await audit(supabase, viewer.userId, "note.remove", "notes", noteId, { reason });
  revalidatePath(`/properties/${propertyId}`);
  return { ok: true, message: "Note removed (kept in the history)." };
}

// ---------------------------------------------------------------------------
// Completion report PDF (spec 3C). Published and accepted content only.
// ---------------------------------------------------------------------------

const SOURCE_LABEL: Record<string, string> = {
  field_capture: "HSU field team, in-app",
  email_in: "emailed by installer",
  admin_upload: "uploaded by HSU",
  drive_import: "from the job folder",
};

export async function generateCompletionReport(propertyId: string): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const supabase = await createClient();
  const { buildCompletionReport, containsPrice } = await import("@/lib/completion-report");
  const { TEMPLATES, itemKind, statusLabel } = await import("@/lib/checklists");
  const { formatDateTime } = await import("@/lib/format");
  const { createHash } = await import("node:crypto");

  const { data: p } = await supabase.from("properties").select("id, address, agency_id").eq("id", propertyId).maybeSingle();
  if (!p) return { ok: false, message: "Property not found." };
  const { data: wos } = await supabase.from("work_orders").select("id, activity_type").eq("property_id", propertyId).is("removed_at", null).order("activity_type");
  const woIds = (wos ?? []).map((w) => w.id);
  if (!woIds.length) return { ok: false, message: "No upgrades on this property." };

  const [{ data: agency }, { data: written }, { data: statuses }, { data: items }, { data: checklists }, { data: files }] = await Promise.all([
    p.agency_id ? supabase.from("agencies").select("name").eq("id", p.agency_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("written_summaries").select("kind, work_order_id, body").eq("property_id", propertyId).eq("status", "published"),
    supabase.from("upgrade_status").select("*").in("work_order_id", woIds).order("set_at", { ascending: false }),
    supabase.from("job_items").select("*").in("work_order_id", woIds).is("removed_at", null).order("created_at"),
    supabase.from("job_checklists").select("*").in("work_order_id", woIds),
    supabase.from("evidence_files").select("*").in("work_order_id", woIds).neq("stage", "assessment")
      .eq("review_status", "accepted").eq("hidden", false).is("deleted_at", null).order("taken_at", { ascending: true, nullsFirst: false }),
  ]);

  const completion = (written ?? []).find((s) => s.kind === "completion")?.body ?? null;
  const texts = [completion, ...(written ?? []).map((s) => s.body), ...(statuses ?? []).map((s) => s.note)];
  if (texts.some((t) => containsPrice(t))) {
    return { ok: false, message: "A published summary or status note mentions a price. Remove it, then generate the report." };
  }

  const upgrades = [];
  for (const w of wos ?? []) {
    const status = (statuses ?? []).find((s) => s.work_order_id === w.id);
    const wItems = (items ?? []).filter((i) => i.work_order_id === w.id);
    const tmpl = wItems[0] ? TEMPLATES[wItems[0].template] : undefined;
    const details: string[] = wItems.map((i) => {
      const k = tmpl ? itemKind(tmpl, i.kind) : undefined;
      const answers = (k?.fields ?? []).filter((f) => i.details?.[f.key]).map((f) => `${f.label}: ${i.details[f.key]}`);
      return `${i.label}${k ? ` (${k.label})` : ""}${answers.length ? ` - ${answers.join("; ")}` : ""}`;
    });
    const cl = (checklists ?? []).find((c) => c.work_order_id === w.id);
    if (cl) {
      const t = TEMPLATES[cl.template];
      for (const q of t?.questions ?? []) if (cl.answers?.[q.key]) details.push(`${q.label} ${cl.answers[q.key]}`);
    }

    const wFiles = (files ?? []).filter((f) => f.work_order_id === w.id);
    const photos = [];
    for (const f of wFiles.filter((x) => x.kind === "photo")) {
      let image: { bytes: Uint8Array; type: "jpg" | "png" } | null = null;
      if (["image/jpeg", "image/png", "image/webp"].includes(f.mime ?? "")) {
        const { data } = await supabase.storage.from("evidence").createSignedUrl(f.storage_path, 300, { transform: { width: 1000, height: 1000, resize: "contain" } });
        const res = data?.signedUrl ? await fetch(data.signedUrl) : null;
        const type = res?.headers.get("content-type") ?? "";
        if (res?.ok && (type.includes("jpeg") || type.includes("png"))) {
          image = { bytes: new Uint8Array(await res.arrayBuffer()), type: type.includes("png") ? "png" : "jpg" };
        }
      }
      const item = wItems.find((i) => i.id === f.job_item_id);
      const slot = item && tmpl ? itemKind(tmpl, item.kind)?.slots.find((s) => s.key === f.checklist_key)?.label : null;
      photos.push({
        label: item ? `${item.label}: ${slot ?? f.phase ?? ""}` : f.phase ? f.phase[0].toUpperCase() + f.phase.slice(1) : "Photo",
        image,
        takenAt: f.taken_at ? formatDateTime(f.taken_at) : null,
        provenance: SOURCE_LABEL[f.source] ?? f.source,
        location: (f.flags ?? []).includes("no_location") ? "no location (supporting evidence)" : f.geo_source === "browser" || f.geo_source === "exif" ? "location recorded" : "no location",
      });
    }
    upgrades.push({
      name: w.activity_type ?? "Upgrade",
      status: statusLabel(status?.status),
      exemptionGround: status?.exemption_ground ?? null,
      statusNote: status?.note ?? null,
      worksSummary: (written ?? []).find((s) => s.kind === "works" && s.work_order_id === w.id)?.body ?? null,
      details,
      photos,
      documents: wFiles.filter((x) => x.kind === "document").map((d) => d.file_name),
    });
  }

  const pdf = await buildCompletionReport({
    address: p.address,
    agency: agency?.name ?? null,
    generatedAt: formatDateTime(new Date().toISOString()),
    completionSummary: completion,
    upgrades,
  });
  const path = `reports/${propertyId}/completion-${Date.now()}.pdf`;
  const { error: upErr } = await supabase.storage.from("evidence").upload(path, pdf, { contentType: "application/pdf", upsert: false });
  if (upErr) return { ok: false, message: `Couldn't store the report: ${upErr.message}` };
  const { data: row, error } = await supabase
    .from("completion_reports")
    .insert({ property_id: propertyId, storage_path: path, sha256: createHash("sha256").update(pdf).digest("hex"), generated_by: viewer.userId })
    .select("id")
    .single();
  if (error) return { ok: false, message: error.message };
  await audit(supabase, viewer.userId, "completion_report.generate", "completion_reports", row.id);
  revalidatePath(`/properties/${propertyId}`);
  return { ok: true, message: "Completion report generated." };
}
