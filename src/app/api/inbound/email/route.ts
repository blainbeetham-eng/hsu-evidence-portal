import { createHash, randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import exifr from "exifr";
import { createServiceClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import { matchProperty } from "@/lib/address-key";
import { exifTimeToIso } from "@/lib/drive";
import { INBOUND_KIND, MIN_IMAGE_BYTES, parseFrom, supplierEmails, verifyWebhook } from "@/lib/inbound";

// Email-in for supplier photos and job reports (spec v0.8 item 4). Resend receives the
// email and calls this with a signed webhook; we fetch the email and its attachments from
// Resend's API and store the files privately, waiting for Blain's review. Nothing here is
// ever visible to a landlord or agency until Blain accepts it.
//
// Filed straight to a job only when the sender is a known supplier email AND the subject's
// address matches a property where that supplier is on exactly one work order. Anything
// else goes to the Inbox for Blain to file.

export const maxDuration = 300;

const RESEND = "https://api.resend.com";

type ResendEmail = { from: string; subject: string | null; text: string | null; created_at: string };
type ResendAttachment = { id: string; filename: string; content_type: string; size: number; download_url: string };

async function resend<T>(path: string, key: string): Promise<T> {
  const res = await fetch(`${RESEND}${path}`, { headers: { authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`Resend ${path} failed (${res.status})`);
  return (await res.json()) as T;
}

const safeName = (name: string) => name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120) || "file";

export async function POST(request: NextRequest) {
  const secret = serverEnv.resendWebhookSecret();
  const apiKey = serverEnv.resendApiKey();
  if (!secret || !apiKey) return NextResponse.json({ error: "Email-in is not set up" }, { status: 503 });

  const body = await request.text();
  const ok = verifyWebhook(secret, {
    id: request.headers.get("svix-id"),
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
  }, body);
  if (!ok) return NextResponse.json({ error: "Bad signature" }, { status: 401 });

  const event = JSON.parse(body) as { type?: string; data?: { email_id?: string } };
  const emailId = event.data?.email_id;
  if (event.type !== "email.received" || !emailId) return NextResponse.json({ ignored: true });

  const db = createServiceClient();
  const { data: seen } = await db.from("inbox_items").select("id").eq("provider_email_id", emailId).maybeSingle();
  if (seen) return NextResponse.json({ duplicate: true });

  const email = await resend<ResendEmail>(`/emails/receiving/${encodeURIComponent(emailId)}`, apiKey);
  const { data: attachments } = await resend<{ data: ResendAttachment[] }>(
    `/emails/receiving/${encodeURIComponent(emailId)}/attachments`, apiKey,
  );
  const from = parseFrom(email.from);

  // Who sent it, and which property and job it's about.
  const [{ data: suppliers }, { data: properties }] = await Promise.all([
    db.from("supplier_orgs").select("id, email").is("removed_at", null),
    db.from("properties").select("id, address").is("removed_at", null),
  ]);
  const supplier = (suppliers ?? []).find((s) => from.email && supplierEmails(s.email).includes(from.email)) ?? null;
  const property = matchProperty(email.subject ?? "", properties ?? []);
  let workOrderId: string | null = null;
  let suggestedWo: string | null = null;
  if (property) {
    const { data: wos } = await db.from("work_orders").select("id, supplier_ids").eq("property_id", property.id).is("removed_at", null);
    const theirs = supplier ? (wos ?? []).filter((w) => (w.supplier_ids as string[]).includes(supplier.id)) : [];
    if (theirs.length === 1) workOrderId = theirs[0].id;
    else if ((wos ?? []).length === 1) suggestedWo = wos![0].id;
  }

  const itemId = randomUUID();
  const { error: itemErr } = await db.from("inbox_items").insert({
    id: itemId,
    provider_email_id: emailId,
    received_at: email.created_at ?? new Date().toISOString(),
    from_email: from.email,
    from_name: from.name,
    subject: email.subject?.slice(0, 500) ?? null,
    body_text: email.text?.slice(0, 20000) ?? null,
    supplier_org_id: supplier?.id ?? null,
    suggested_property_id: property?.id ?? null,
    suggested_work_order_id: workOrderId ?? suggestedWo,
    status: workOrderId ? "filed" : "new",
    filed_work_order_id: workOrderId,
    filed_at: workOrderId ? new Date().toISOString() : null,
  });
  if (itemErr) {
    if (itemErr.code === "23505") return NextResponse.json({ duplicate: true }); // a retry raced us
    return NextResponse.json({ error: itemErr.message }, { status: 500 }); // Resend retries
  }

  const skipped: string[] = [];
  let kept = 0;
  for (const a of attachments ?? []) {
    const mime = (a.content_type || "").toLowerCase().split(";")[0];
    const kind = INBOUND_KIND[mime];
    if (!kind) { skipped.push(`${a.filename} (file type not used)`); continue; }
    if (kind === "photo" && a.size < MIN_IMAGE_BYTES) continue; // signature logos, not worth listing
    try {
      const res = await fetch(a.download_url);
      if (!res.ok) throw new Error(`download failed (${res.status})`);
      const buf = Buffer.from(await res.arrayBuffer());
      const path = `inbox/${itemId}/${randomUUID()}-${safeName(a.filename)}`;
      const { error: upErr } = await db.storage.from("evidence").upload(path, buf, { contentType: mime, upsert: false });
      if (upErr) throw new Error(upErr.message);

      let lat: number | null = null, lng: number | null = null, takenAt: string | null = null;
      if (kind === "photo") {
        const exif = await exifr.parse(buf, { pick: ["DateTimeOriginal"], reviveValues: false }).catch(() => null);
        const gps = await exifr.gps(buf).catch(() => null);
        lat = gps?.latitude ?? null;
        lng = gps?.longitude ?? null;
        takenAt = exifTimeToIso(typeof exif?.DateTimeOriginal === "string" ? exif.DateTimeOriginal : null);
      }
      const { error: rowErr } = await db.from("evidence_files").insert({
        work_order_id: workOrderId,
        inbox_item_id: itemId,
        kind,
        stage: "works",
        storage_path: path,
        file_name: a.filename.slice(0, 200),
        mime,
        size_bytes: buf.length,
        sha256: createHash("sha256").update(buf).digest("hex"),
        source: "email_in",
        review_status: "pending",
        received_from: from.email,
        taken_at: takenAt,
        lat,
        lng,
        geo_source: kind === "photo" ? (lat !== null ? "exif" : "none") : null,
        flags: kind === "photo" && lat === null ? ["no_location"] : [],
      });
      if (rowErr) throw new Error(rowErr.message);
      kept += 1;
    } catch (e) {
      skipped.push(`${a.filename} (${e instanceof Error ? e.message : "failed"})`);
    }
  }

  await db.from("inbox_items").update({ skipped }).eq("id", itemId);
  await db.from("audit_log").insert({
    action: "inbound.email", entity: "inbox_items", entity_id: itemId,
    meta: { kept, skipped: skipped.length, filed: !!workOrderId, supplier: supplier?.id ?? null },
  });
  return NextResponse.json({ ok: true, kept, filed: !!workOrderId });
}
