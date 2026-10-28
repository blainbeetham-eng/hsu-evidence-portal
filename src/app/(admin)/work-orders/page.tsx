import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/dal";
import { Pager, PAGE_SIZE } from "@/lib/list";

export const metadata = { title: "Work orders — HomeStar Evidence Portal" };

// Filter options come from the synced data (work_order_facets), so renamed or new
// Airtable options appear automatically. This list only sets the display order of
// stages we know; anything else is listed after them alphabetically.
const STAGE_ORDER = [
  "New Lead", "Cleared to Proceed", "Consent Granted", "Tender Issued", "Client Quote Sent",
  "Client Quote Accepted", "Works Scheduled", "Upgrade Complete", "Invoice Sent", "Invoice Paid",
];

function byStageOrder(a: string, b: string) {
  const ia = STAGE_ORDER.indexOf(a), ib = STAGE_ORDER.indexOf(b);
  if (ia !== -1 || ib !== -1) return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
  return a.localeCompare(b);
}

type Search = { activity?: string; status?: string; test?: string; page?: string };

export default async function WorkOrdersPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireAdmin();
  const { activity = "", status = "", test, page = "1" } = await searchParams;
  const pageNo = Math.max(1, Number(page) || 1);
  const supabase = await createClient();

  let query = supabase
    .from("work_orders")
    .select("id, property_id, activity_type, pipeline_status, source_order_ref, is_test", { count: "exact" })
    .is("removed_at", null)
    .order("source_order_ref", { ascending: false, nullsFirst: false })
    .range((pageNo - 1) * PAGE_SIZE, pageNo * PAGE_SIZE - 1);
  if (activity) query = query.eq("activity_type", activity);
  if (status) query = query.eq("pipeline_status", status);
  if (!test) query = query.eq("is_test", false);
  const [{ data: rows, count, error }, { data: facets }] = await Promise.all([
    query,
    supabase.rpc("work_order_facets"),
  ]);
  if (error) throw new Error(error.message);
  const facetValues = (kind: string) =>
    ((facets ?? []) as { kind: string; value: string }[]).filter((f) => f.kind === kind).map((f) => f.value);
  const activityTypes = facetValues("activity_type").sort();
  const stages = facetValues("pipeline_status").sort(byStageOrder);

  const propertyIds = [...new Set((rows ?? []).map((r) => r.property_id).filter(Boolean))] as string[];
  const { data: props } = propertyIds.length
    ? await supabase.from("properties").select("id, address").in("id", propertyIds)
    : { data: [] as { id: string; address: string }[] };
  const address = new Map((props ?? []).map((p) => [p.id, p.address]));

  return (
    <>
      <h1>Work orders</h1>
      <form className="filters">
        <div>
          <label htmlFor="activity">Upgrade</label>
          <select id="activity" name="activity" defaultValue={activity}>
            <option value="">All</option>
            {activityTypes.map((a) => <option key={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="status">Pipeline status</label>
          <select id="status" name="status" defaultValue={status}>
            <option value="">All</option>
            {stages.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label><input type="checkbox" name="test" value="1" defaultChecked={!!test} /> Include test data</label>
        </div>
        <button type="submit">Filter</button>
      </form>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Property</th><th>Upgrade</th><th>Pipeline status</th><th>Source order ref</th></tr></thead>
          <tbody>
            {(rows ?? []).map((w) => (
              <tr key={w.id}>
                <td>
                  {w.property_id ? <Link href={`/properties/${w.property_id}`}>{address.get(w.property_id) ?? "(property not synced)"}</Link> : "—"}
                  {w.is_test && <> <span className="tag warn">test data</span></>}
                </td>
                <td>{w.activity_type ?? "—"}</td>
                <td>{w.pipeline_status ?? "—"}</td>
                <td>{w.source_order_ref ?? "—"}</td>
              </tr>
            ))}
            {rows?.length === 0 && <tr><td colSpan={4} className="muted">No work orders match.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager page={pageNo} total={count ?? 0} params={{ activity, status, test }} />
    </>
  );
}
