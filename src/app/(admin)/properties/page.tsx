import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/dal";
import { formatDate } from "@/lib/format";
import { escapeLike, Pager, PAGE_SIZE } from "@/lib/list";

export const metadata = { title: "Properties — HomeStar Evidence Portal" };

type Search = { q?: string; page?: string; removed?: string };

export default async function PropertiesPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireAdmin();
  const { q = "", page = "1", removed } = await searchParams;
  const pageNo = Math.max(1, Number(page) || 1);
  const supabase = await createClient();

  let query = supabase
    .from("properties")
    .select("id, address, agency_id, lease_renewal_date, lease_renewal_date_override, removed_at", { count: "exact" })
    .order("address")
    .range((pageNo - 1) * PAGE_SIZE, pageNo * PAGE_SIZE - 1);
  if (q) query = query.ilike("address", `%${escapeLike(q)}%`);
  if (!removed) query = query.is("removed_at", null);
  const { data: rows, count, error } = await query;
  if (error) throw new Error(error.message);

  const ids = (rows ?? []).map((r) => r.id);
  const [{ data: agencies }, { data: wos }] = await Promise.all([
    supabase.from("agencies").select("id, name"),
    ids.length
      ? supabase.from("work_orders").select("property_id").in("property_id", ids).is("removed_at", null)
      : Promise.resolve({ data: [] as { property_id: string }[] }),
  ]);
  const agencyName = new Map((agencies ?? []).map((a) => [a.id, a.name]));
  const woCount = new Map<string, number>();
  for (const w of wos ?? []) woCount.set(w.property_id, (woCount.get(w.property_id) ?? 0) + 1);

  return (
    <>
      <h1>Properties</h1>
      <form className="filters">
        <div>
          <label htmlFor="q">Address contains</label>
          <input id="q" name="q" defaultValue={q} />
        </div>
        <div>
          <label>
            <input type="checkbox" name="removed" value="1" defaultChecked={!!removed} /> Include removed
          </label>
        </div>
        <button type="submit">Search</button>
      </form>

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Address</th><th>Agency</th><th>Lease renewal</th><th>Work orders</th></tr>
          </thead>
          <tbody>
            {(rows ?? []).map((p) => (
              <tr key={p.id}>
                <td>
                  <Link href={`/properties/${p.id}`}>{p.address}</Link>
                  {p.removed_at && <> <span className="tag bad">removed from Airtable</span></>}
                </td>
                <td>{p.agency_id ? agencyName.get(p.agency_id) ?? "—" : "—"}</td>
                <td>{formatDate(p.lease_renewal_date_override ?? p.lease_renewal_date)}</td>
                <td>{woCount.get(p.id) ?? 0}</td>
              </tr>
            ))}
            {rows?.length === 0 && (
              <tr><td colSpan={4} className="muted">No properties match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager page={pageNo} total={count ?? 0} params={{ q, removed }} />
    </>
  );
}
