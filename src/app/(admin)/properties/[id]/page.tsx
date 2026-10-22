import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/dal";
import { formatDate, formatDateTime } from "@/lib/format";
import { AIRTABLE_BASE_ID, TABLES } from "@/lib/airtable/allowlist";

export const metadata = { title: "Property — HomeStar Evidence Portal" };

export default async function PropertyPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const supabase = await createClient();

  const { data: p } = await supabase.from("properties").select("*").eq("id", id).maybeSingle();
  if (!p) notFound();

  const { data: wos } = await supabase
    .from("work_orders")
    .select("id, activity_type, pipeline_status, source_order_ref, landlord_ids, is_test, removed_at")
    .eq("property_id", id)
    .order("activity_type");

  const usesCurrentLandlord = p.current_landlord_ids.length > 0;
  const landlordIds: string[] = usesCurrentLandlord
    ? p.current_landlord_ids
    : [...new Set((wos ?? []).filter((w) => !w.removed_at).flatMap((w) => w.landlord_ids as string[]))];

  const [{ data: agency }, { data: landlords }] = await Promise.all([
    p.agency_id ? supabase.from("agencies").select("name").eq("id", p.agency_id).maybeSingle() : Promise.resolve({ data: null }),
    landlordIds.length
      ? supabase.from("contacts").select("id, name, email, consent_status, removed_at").in("id", landlordIds)
      : Promise.resolve({ data: [] as { id: string; name: string | null; email: string | null; consent_status: string | null; removed_at: string | null }[] }),
  ]);

  const airtableUrl = `https://airtable.com/${AIRTABLE_BASE_ID}/${TABLES.properties.tableId}/${p.id}`;

  return (
    <>
      <p className="small"><Link href="/properties">← Properties</Link></p>
      <h1>{p.address}</h1>
      {p.removed_at && <div className="banner bad">This property was removed from Airtable on {formatDateTime(p.removed_at)}.</div>}

      <dl className="facts">
        <dt>Agency</dt><dd>{agency?.name ?? "—"}</dd>
        <dt>Property type</dt><dd>{p.property_type ?? "—"}</dd>
        <dt>Lease renewal date</dt>
        <dd>
          {formatDate(p.lease_renewal_date_override ?? p.lease_renewal_date)}
          {p.lease_renewal_date_override && <span className="muted small"> (portal override; Airtable says {formatDate(p.lease_renewal_date)})</span>}
          {!p.lease_renewal_date && !p.lease_renewal_date_override && <span className="muted small"> Not set in Airtable. Compliance applicability will show “not assessed”.</span>}
        </dd>
        <dt>Last synced</dt><dd>{formatDateTime(p.synced_at)}</dd>
        <dt>Airtable</dt><dd><a href={airtableUrl} target="_blank" rel="noreferrer">Open record</a></dd>
      </dl>

      <h2>Landlord access</h2>
      <p className="muted small">
        {usesCurrentLandlord
          ? "Taken from the property's Current Landlord in Airtable."
          : "No Current Landlord on the property, so taken from the Landlord on its work orders."}
        {" "}A landlord can be invited only while Consent Status is Granted (landlord logins open in Phase 1b).
      </p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Consent</th></tr></thead>
          <tbody>
            {(landlords ?? []).map((c) => (
              <tr key={c.id}>
                <td>{c.name ?? "—"}{c.removed_at && <> <span className="tag bad">removed</span></>}</td>
                <td>{c.email ?? "—"}</td>
                <td><span className={`tag ${c.consent_status === "Granted" ? "" : c.consent_status === "Declined" ? "bad" : "warn"}`}>{c.consent_status ?? "Unknown"}</span></td>
              </tr>
            ))}
            {landlords?.length === 0 && <tr><td colSpan={3} className="muted">No landlord linked in Airtable.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2>Work orders</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Upgrade</th><th>Pipeline status</th><th>Source order ref</th><th></th></tr></thead>
          <tbody>
            {(wos ?? []).map((w) => (
              <tr key={w.id}>
                <td>{w.activity_type ?? "—"}</td>
                <td>{w.pipeline_status ?? "—"}</td>
                <td>{w.source_order_ref ?? "—"}</td>
                <td>
                  {w.is_test && <span className="tag warn">test data</span>}{" "}
                  {w.removed_at && <span className="tag bad">removed</span>}
                </td>
              </tr>
            ))}
            {wos?.length === 0 && <tr><td colSpan={4} className="muted">No work orders.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
