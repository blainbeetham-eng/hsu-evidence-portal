import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/dal";
import { syncNow } from "./actions";
import { SyncButton } from "./sync-button";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Overview — HomeStar Evidence Portal" };

type SyncRun = {
  id: number;
  trigger: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  counts: Record<string, { fetched: number; removed: number }>;
  unexpected_fields: string[];
  error: string | null;
};

export default async function OverviewPage() {
  await requireAdmin();
  const supabase = await createClient();

  const count = (table: string) =>
    supabase.from(table).select("id", { count: "exact", head: true }).is("removed_at", null);

  const [properties, workOrders, contacts, agencies, runs] = await Promise.all([
    count("properties"),
    supabase.from("work_orders").select("id", { count: "exact", head: true }).is("removed_at", null).eq("is_test", false),
    count("contacts"),
    count("agencies"),
    supabase.from("sync_runs").select("*").order("started_at", { ascending: false }).limit(8),
  ]);

  const syncRuns = (runs.data ?? []) as SyncRun[];
  const last = syncRuns[0];
  const lastOk = syncRuns.find((r) => r.status === "succeeded");

  return (
    <>
      <h1>Overview</h1>

      {!last && <div className="banner warn">No Airtable sync has run yet. Press Sync now to load properties and work orders.</div>}
      {last?.status === "failed" && (
        <div className="banner bad">
          <strong>The last Airtable sync failed</strong> ({formatDateTime(last.started_at)}). Nothing was changed by that run.
          <div className="small">{last.error}</div>
        </div>
      )}

      <div className="cards">
        <div className="card"><div className="n">{properties.count ?? 0}</div>Properties</div>
        <div className="card"><div className="n">{workOrders.count ?? 0}</div>Work orders (excl. test data)</div>
        <div className="card"><div className="n">{contacts.count ?? 0}</div>Contacts</div>
        <div className="card"><div className="n">{agencies.count ?? 0}</div>Agencies</div>
      </div>

      <h2>Airtable sync</h2>
      <p className="muted">
        Read-only copy of Airtable. Runs automatically once a day.
        {lastOk && <> Last successful sync: {formatDateTime(lastOk.finished_at ?? lastOk.started_at)}.</>}
      </p>
      <form action={syncNow}>
        <SyncButton />
      </form>

      {syncRuns.length > 0 && (
        <div className="table-wrap" style={{ marginTop: "1rem" }}>
          <table>
            <thead>
              <tr><th>Started</th><th>Trigger</th><th>Result</th><th>Records</th><th>Removed</th></tr>
            </thead>
            <tbody>
              {syncRuns.map((r) => {
                const fetched = Object.values(r.counts ?? {}).reduce((n, c) => n + (c.fetched ?? 0), 0);
                const removed = Object.values(r.counts ?? {}).reduce((n, c) => n + (c.removed ?? 0), 0);
                return (
                  <tr key={r.id}>
                    <td>{formatDateTime(r.started_at)}</td>
                    <td>{r.trigger}</td>
                    <td>
                      <span className={`tag ${r.status === "failed" ? "bad" : r.status === "running" ? "warn" : ""}`}>{r.status}</span>
                      {r.unexpected_fields.length > 0 && <div className="small error">Unexpected fields: {r.unexpected_fields.join(", ")}</div>}
                    </td>
                    <td>{fetched}</td>
                    <td>{removed}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
