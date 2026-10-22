// One full Airtable -> portal sync.
//
// Order: fetch and validate every table first; write nothing unless all of them
// came back clean. Then upsert (stamping synced_at with this run's start time)
// and finally mark rows not seen in this run as removed.
import { fetchTable as defaultFetchTable, UnexpectedFieldsError, type AirtableRecord } from "@/lib/airtable/fetch";
import type { TableKey } from "@/lib/airtable/allowlist";
import { mapAgency, mapContact, mapProperty, mapSupplier, mapWorkOrder } from "@/lib/airtable/map";

export type MirrorTable = "agencies" | "supplier_orgs" | "contacts" | "properties" | "work_orders";
export type Row = { id: string } & Record<string, unknown>;

export interface SyncStore {
  startRun(trigger: "cron" | "manual" | "test", triggeredBy: string | null): Promise<number>;
  finishRun(
    runId: number,
    result: { status: "succeeded" | "failed"; counts: Record<string, unknown>; unexpectedFields?: string[]; error?: string },
  ): Promise<void>;
  countActive(table: MirrorTable): Promise<number>;
  upsert(table: MirrorTable, rows: Row[]): Promise<void>;
  markRemoved(table: MirrorTable, syncedBefore: string): Promise<number>;
}

// Written in dependency order (agencies before properties before work orders).
const PLAN: { source: TableKey; target: MirrorTable; map: (r: AirtableRecord, at: string) => Row }[] = [
  { source: "agencies", target: "agencies", map: mapAgency },
  { source: "suppliers", target: "supplier_orgs", map: mapSupplier },
  { source: "contacts", target: "contacts", map: mapContact },
  { source: "properties", target: "properties", map: mapProperty },
  { source: "workOrders", target: "work_orders", map: mapWorkOrder },
];

export type SyncResult = {
  runId: number;
  status: "succeeded" | "failed";
  counts: Record<string, { fetched: number; removed: number }>;
  error?: string;
};

export async function runSync(opts: {
  trigger: "cron" | "manual" | "test";
  triggeredBy?: string | null;
  token: string;
  store: SyncStore;
  fetchTable?: typeof defaultFetchTable;
  now?: () => Date;
}): Promise<SyncResult> {
  const { store, token } = opts;
  const fetchTable = opts.fetchTable ?? defaultFetchTable;
  const runStart = (opts.now ?? (() => new Date()))().toISOString();
  const runId = await store.startRun(opts.trigger, opts.triggeredBy ?? null);
  const counts: SyncResult["counts"] = {};

  try {
    const fetched: { target: MirrorTable; rows: Row[] }[] = [];
    for (const step of PLAN) {
      const records = await fetchTable(step.source, token);
      // An empty table would mark every existing row removed. Treat that as a
      // configuration problem (wrong base, lost access) rather than real data.
      if (records.length === 0 && (await store.countActive(step.target)) > 0) {
        throw new Error(`Airtable returned no ${step.source} records; refusing to mark all ${step.target} removed`);
      }
      fetched.push({ target: step.target, rows: records.map((r) => step.map(r, runStart)) });
    }

    for (const { target, rows } of fetched) {
      await store.upsert(target, rows);
      counts[target] = { fetched: rows.length, removed: 0 };
    }
    for (const { target } of fetched) {
      counts[target].removed = await store.markRemoved(target, runStart);
    }

    await store.finishRun(runId, { status: "succeeded", counts });
    return { runId, status: "succeeded", counts };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const unexpectedFields = e instanceof UnexpectedFieldsError ? e.fields : [];
    await store.finishRun(runId, { status: "failed", counts, unexpectedFields, error });
    return { runId, status: "failed", counts, error };
  }
}
