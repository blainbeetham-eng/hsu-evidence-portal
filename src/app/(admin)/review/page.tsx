import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/dal";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Review — HomeStar Evidence Portal" };

const SOURCE: Record<string, string> = { field_capture: "Field team", email_in: "Emailed in", admin_upload: "Upload", drive_import: "Drive" };

/** Everything waiting for Blain: files to review (by property) and the Inbox. */
export default async function ReviewPage() {
  await requireAdmin();
  const supabase = await createClient();

  const [{ data: files }, { count: inboxCount }] = await Promise.all([
    supabase
      .from("evidence_files")
      .select("id, work_order_id, source, review_status, created_at")
      .in("review_status", ["pending", "needs_more"])
      .not("work_order_id", "is", null)
      .is("deleted_at", null)
      .order("created_at"),
    supabase.from("inbox_items").select("id", { count: "exact", head: true }).eq("status", "new"),
  ]);

  const woIds = [...new Set((files ?? []).map((f) => f.work_order_id as string))];
  const { data: wos } = woIds.length
    ? await supabase.from("work_orders").select("id, activity_type, property_id").in("id", woIds)
    : { data: [] as { id: string; activity_type: string | null; property_id: string | null }[] };
  const propIds = [...new Set((wos ?? []).map((w) => w.property_id).filter(Boolean) as string[])];
  const { data: props } = propIds.length
    ? await supabase.from("properties").select("id, address").in("id", propIds)
    : { data: [] as { id: string; address: string }[] };

  const wo = new Map((wos ?? []).map((w) => [w.id, w]));
  const address = new Map((props ?? []).map((p) => [p.id, p.address]));
  const rows = woIds.map((id) => {
    const fs = (files ?? []).filter((f) => f.work_order_id === id);
    return {
      id,
      propertyId: wo.get(id)?.property_id ?? null,
      upgrade: wo.get(id)?.activity_type ?? "Work order",
      pending: fs.filter((f) => f.review_status === "pending").length,
      needsMore: fs.filter((f) => f.review_status === "needs_more").length,
      sources: [...new Set(fs.map((f) => SOURCE[f.source] ?? f.source))].join(", "),
      oldest: fs[0]?.created_at,
    };
  });

  return (
    <>
      <h1>Review</h1>
      <p>
        <Link href="/inbox">Inbox</Link>: {inboxCount ?? 0} email{inboxCount === 1 ? "" : "s"} to file.
      </p>
      <p className="muted small">Photos and documents from the field team and emailed in. Nothing here is visible to landlords or agencies until you accept it on the property page.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Property</th><th>Upgrade</th><th>Waiting</th><th>Asked for more</th><th>From</th><th>Oldest</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.propertyId ? <Link href={`/properties/${r.propertyId}`}>{address.get(r.propertyId) ?? r.propertyId}</Link> : "—"}</td>
                <td>{r.upgrade}</td>
                <td>{r.pending}</td>
                <td>{r.needsMore}</td>
                <td>{r.sources}</td>
                <td>{formatDateTime(r.oldest)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="muted">Nothing waiting.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
