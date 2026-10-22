import { describe, expect, it, vi } from "vitest";
import { fetchTable, UnexpectedFieldsError, type AirtableRecord } from "@/lib/airtable/fetch";
import { TABLES, type TableKey } from "@/lib/airtable/allowlist";
import { runSync, type MirrorTable, type Row, type SyncStore } from "@/lib/sync/run-sync";

const F = TABLES;

function rec(id: string, fields: Record<string, unknown>): AirtableRecord {
  return { id, createdTime: "2026-10-01T00:00:00.000Z", fields };
}

const AIRTABLE: Record<TableKey, AirtableRecord[]> = {
  agencies: [rec("recA1", { [F.agencies.fields.name]: "Marshall White" })],
  suppliers: [rec("recS1", { [F.suppliers.fields.name]: "Batt Co", [F.suppliers.fields.email]: "jobs@batt.co" })],
  contacts: [
    rec("recC1", {
      [F.contacts.fields.name]: "Richard Lewis",
      [F.contacts.fields.email]: "Richard@Example.com ",
      [F.contacts.fields.role]: "Landlord",
      [F.contacts.fields.consentStatus]: "Granted",
    }),
  ],
  properties: [
    rec("recP1", {
      [F.properties.fields.address]: "57 Wills St",
      [F.properties.fields.agency]: ["recA1"],
      [F.properties.fields.currentLandlord]: ["recC1"],
      [F.properties.fields.leaseRenewalDate]: "2027-03-14",
    }),
  ],
  workOrders: [
    rec("recW1", {
      [F.workOrders.fields.property]: ["recP1"],
      [F.workOrders.fields.activityType]: "Insulation",
      [F.workOrders.fields.pipelineStatus]: "New Lead",
      [F.workOrders.fields.landlord]: ["recC1"],
      [F.workOrders.fields.testData]: true,
    }),
  ],
};

function memoryStore(initial: Partial<Record<MirrorTable, Row[]>> = {}) {
  const tables = new Map<MirrorTable, Map<string, Row>>();
  for (const t of ["agencies", "supplier_orgs", "contacts", "properties", "work_orders"] as MirrorTable[]) {
    tables.set(t, new Map((initial[t] ?? []).map((r) => [r.id, r])));
  }
  const runs: Record<number, unknown> = {};
  const store: SyncStore = {
    startRun: async () => 1,
    finishRun: async (id, r) => void (runs[id] = r),
    countActive: async (t) => [...tables.get(t)!.values()].filter((r) => !r.removed_at).length,
    upsert: async (t, rows) => rows.forEach((r) => tables.get(t)!.set(r.id, { ...tables.get(t)!.get(r.id), ...r })),
    markRemoved: async (t, before) => {
      let n = 0;
      for (const r of tables.get(t)!.values()) {
        if (!r.removed_at && String(r.synced_at) < before) { r.removed_at = "now"; n++; }
      }
      return n;
    },
  };
  return { store, tables, runs };
}

const fakeFetch = (data = AIRTABLE) => async (t: TableKey) => data[t];

describe("runSync", () => {
  it("maps and writes every mirror table", async () => {
    const { store, tables } = memoryStore();
    const res = await runSync({ trigger: "test", token: "x", store, fetchTable: fakeFetch() });
    expect(res.status).toBe("succeeded");
    expect(tables.get("properties")!.get("recP1")).toMatchObject({
      address: "57 Wills St",
      agency_id: "recA1",
      current_landlord_ids: ["recC1"],
      lease_renewal_date: "2027-03-14",
      removed_at: null,
    });
    expect(tables.get("contacts")!.get("recC1")).toMatchObject({ email: "richard@example.com", consent_status: "Granted" });
    expect(tables.get("work_orders")!.get("recW1")).toMatchObject({ property_id: "recP1", is_test: true });
  });

  it("marks rows that disappeared from Airtable as removed, and restores them if they return", async () => {
    const { store, tables } = memoryStore({
      properties: [{ id: "recGone", address: "old", synced_at: "2026-01-01T00:00:00.000Z", removed_at: null }],
    });
    const res = await runSync({ trigger: "test", token: "x", store, fetchTable: fakeFetch() });
    expect(res.counts.properties).toEqual({ fetched: 1, removed: 1 });
    expect(tables.get("properties")!.get("recGone")!.removed_at).toBe("now");

    tables.get("properties")!.get("recP1")!.removed_at = "earlier";
    await runSync({ trigger: "test", token: "x", store, fetchTable: fakeFetch() });
    expect(tables.get("properties")!.get("recP1")!.removed_at).toBeNull();
  });

  it("writes nothing when a later table fails", async () => {
    const { store, tables, runs } = memoryStore();
    const failing = async (t: TableKey) => {
      if (t === "workOrders") throw new UnexpectedFieldsError(["tblTzwknkrpee6XUG.fldFdbrFbXMqUDOvp"]);
      return AIRTABLE[t];
    };
    const res = await runSync({ trigger: "test", token: "x", store, fetchTable: failing });
    expect(res.status).toBe("failed");
    for (const t of tables.values()) expect(t.size).toBe(0);
    expect(runs[1]).toMatchObject({ status: "failed", unexpectedFields: ["tblTzwknkrpee6XUG.fldFdbrFbXMqUDOvp"] });
  });

  it("refuses to wipe a table when Airtable suddenly returns nothing", async () => {
    const { store, tables } = memoryStore({
      properties: [{ id: "recP1", address: "57 Wills St", synced_at: "2026-01-01", removed_at: null }],
    });
    const res = await runSync({ trigger: "test", token: "x", store, fetchTable: fakeFetch({ ...AIRTABLE, properties: [] }) });
    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/refusing/);
    expect(tables.get("properties")!.get("recP1")!.removed_at).toBeNull();
  });
});

describe("fetchTable", () => {
  function airtableResponse(pages: { records: AirtableRecord[]; offset?: string }[]) {
    const calls: string[] = [];
    const impl = vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(JSON.stringify(pages[calls.length - 1]), { status: 200 });
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  it("requests only allowlisted field IDs and follows pagination", async () => {
    const { impl, calls } = airtableResponse([
      { records: [rec("recA1", {})], offset: "page2" },
      { records: [rec("recA2", {})] },
    ]);
    const records = await fetchTable("agencies", "tok", impl);
    expect(records.map((r) => r.id)).toEqual(["recA1", "recA2"]);
    expect(calls).toHaveLength(2);
    const url = new URL(calls[0]);
    expect(url.searchParams.getAll("fields[]")).toEqual([F.agencies.fields.name]);
    expect(url.searchParams.get("returnFieldsByFieldId")).toBe("true");
    expect(new URL(calls[1]).searchParams.get("offset")).toBe("page2");
  });

  it("fails if Airtable returns a field outside the allowlist", async () => {
    const { impl } = airtableResponse([
      { records: [rec("recW1", { [F.workOrders.fields.activityType]: "Insulation", fldFdbrFbXMqUDOvp: 1234 })] },
    ]);
    await expect(fetchTable("workOrders", "tok", impl)).rejects.toThrow(/fldFdbrFbXMqUDOvp/);
  });
});
