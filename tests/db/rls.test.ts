import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, createTestDb, ids, type Claims } from "./harness";

// Users
const U = {
  admin: "00000000-0000-0000-0000-000000000001",
  agency1: "00000000-0000-0000-0000-000000000002",
  agency2: "00000000-0000-0000-0000-000000000003",
  landlordC1: "00000000-0000-0000-0000-000000000004",
  landlordC2: "00000000-0000-0000-0000-000000000005",
  landlordC3: "00000000-0000-0000-0000-000000000006",
  installerS1: "00000000-0000-0000-0000-000000000007",
  installerS2: "00000000-0000-0000-0000-000000000008",
  noProfile: "00000000-0000-0000-0000-000000000009",
};

// Fixture:
//   Agency A1: P1 (current landlord C1), P3 (current landlord C3; old WO lists C1)
//   Agency A2: P2 (no current landlord; WO landlord C2, consent Pending)
//              P4 (no current landlord; WO landlord C4, consent Granted)
//   Assignments: W1 -> S1 (active), W2 -> S2 (active), W2 -> S1 (ended)
const SEED = `
  insert into auth.users (id) values ${Object.values(U).map((id) => `('${id}')`).join(",")};

  insert into public.agencies (id, name) values ('recA1', 'Agency One'), ('recA2', 'Agency Two');
  insert into public.supplier_orgs (id, name) values ('recS1', 'Supplier One'), ('recS2', 'Supplier Two');
  insert into public.contacts (id, name, email, role, consent_status) values
    ('recC1', 'Landlord One', 'c1@example.com', 'Landlord', 'Granted'),
    ('recC2', 'Landlord Two', 'c2@example.com', 'Landlord', 'Pending'),
    ('recC3', 'Landlord Three', 'c3@example.com', 'Landlord', 'Granted'),
    ('recC4', 'Landlord Four', 'c4@example.com', 'Landlord', 'Granted');
  insert into public.properties (id, address, agency_id, current_landlord_ids) values
    ('recP1', '1 One St', 'recA1', '{recC1}'),
    ('recP2', '2 Two St', 'recA2', '{}'),
    ('recP3', '3 Three St', 'recA1', '{recC3}'),
    ('recP4', '4 Four St', 'recA2', '{}');
  insert into public.work_orders (id, property_id, activity_type, landlord_ids) values
    ('recW1', 'recP1', 'Insulation', '{recC1}'),
    ('recW2', 'recP2', 'Draughtproofing', '{recC2}'),
    ('recW3', 'recP3', 'Insulation', '{recC1}'),
    ('recW4', 'recP4', 'Showerheads', '{recC4}');
  insert into public.work_order_assignments (work_order_id, supplier_org_id, source, ended_at) values
    ('recW1', 'recS1', 'admin', null),
    ('recW2', 'recS2', 'admin', null),
    ('recW2', 'recS1', 'admin', now());
  insert into public.sync_runs (trigger, status) values ('test', 'succeeded');
  insert into public.audit_log (action) values ('test');

  insert into public.profiles (id, role, agency_id, contact_id, supplier_org_id) values
    ('${U.admin}', 'admin', null, null, null),
    ('${U.agency1}', 'agency_user', 'recA1', null, null),
    ('${U.agency2}', 'agency_user', 'recA2', null, null),
    ('${U.landlordC1}', 'landlord', null, 'recC1', null),
    ('${U.landlordC2}', 'landlord', null, 'recC2', null),
    ('${U.landlordC3}', 'landlord', null, 'recC3', null),
    ('${U.installerS1}', 'installer', null, null, 'recS1'),
    ('${U.installerS2}', 'installer', null, null, 'recS2');
`;

const MIRROR_TABLES = ["agencies", "supplier_orgs", "contacts", "properties", "work_orders"];
const ALL_TABLES = [...MIRROR_TABLES, "profiles", "work_order_assignments", "sync_runs", "audit_log"];

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(SEED);
});

const aal2 = (sub: string): Claims => ({ sub, aal: "aal2" });
const aal1 = (sub: string): Claims => ({ sub, aal: "aal1" });

describe("admin", () => {
  it("with MFA sees every row in every table", async () => {
    await as(db, aal2(U.admin), async (tx) => {
      expect(await ids(tx, "properties")).toEqual(["recP1", "recP2", "recP3", "recP4"]);
      expect(await ids(tx, "work_orders")).toEqual(["recW1", "recW2", "recW3", "recW4"]);
      expect(await ids(tx, "contacts")).toHaveLength(4);
      expect(await ids(tx, "sync_runs")).toHaveLength(1);
      expect(await ids(tx, "audit_log")).toHaveLength(1);
      expect(await ids(tx, "profiles")).toHaveLength(8);
    });
  });

  it("without MFA sees nothing but its own profile", async () => {
    await as(db, aal1(U.admin), async (tx) => {
      for (const t of MIRROR_TABLES.concat("sync_runs", "audit_log", "work_order_assignments")) {
        expect(await ids(tx, t), t).toEqual([]);
      }
      expect(await ids(tx, "profiles")).toEqual([U.admin]);
    });
  });
});

describe("agency_user", () => {
  it("sees only its own agency's properties and work orders", async () => {
    await as(db, aal2(U.agency1), async (tx) => {
      expect(await ids(tx, "properties")).toEqual(["recP1", "recP3"]);
      expect(await ids(tx, "work_orders")).toEqual(["recW1", "recW3"]);
      expect(await ids(tx, "agencies")).toEqual(["recA1"]);
    });
    await as(db, aal2(U.agency2), async (tx) => {
      expect(await ids(tx, "properties")).toEqual(["recP2", "recP4"]);
      expect(await ids(tx, "work_orders")).toEqual(["recW2", "recW4"]);
      expect(await ids(tx, "agencies")).toEqual(["recA2"]);
    });
  });

  it("cannot read contacts, suppliers, sync runs or audit log", async () => {
    await as(db, aal2(U.agency1), async (tx) => {
      for (const t of ["contacts", "supplier_orgs", "sync_runs", "audit_log", "work_order_assignments"]) {
        expect(await ids(tx, t), t).toEqual([]);
      }
    });
  });

  it("without MFA sees nothing", async () => {
    await as(db, aal1(U.agency1), async (tx) => {
      for (const t of MIRROR_TABLES) expect(await ids(tx, t), t).toEqual([]);
    });
  });
});

describe("landlord", () => {
  it("sees the property where they are Current Landlord, not an old one listed only on a work order", async () => {
    await as(db, aal1(U.landlordC1), async (tx) => {
      expect(await ids(tx, "properties")).toEqual(["recP1"]);
      expect(await ids(tx, "work_orders")).toEqual(["recW1"]);
    });
    await as(db, aal1(U.landlordC3), async (tx) => {
      expect(await ids(tx, "properties")).toEqual(["recP3"]);
      expect(await ids(tx, "work_orders")).toEqual(["recW3"]);
    });
  });

  it("falls back to Work Order -> Landlord when the property has no Current Landlord", async () => {
    // Give C4 a landlord login for this test only.
    await db.transaction(async (tx) => {
      await tx.exec(`
        insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000c4');
        insert into public.profiles (id, role, contact_id) values ('00000000-0000-0000-0000-0000000000c4', 'landlord', 'recC4');
      `);
      await tx.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: "00000000-0000-0000-0000-0000000000c4", aal: "aal1" }),
      ]);
      await tx.exec("set local role authenticated");
      const p = await tx.query<{ id: string }>("select id from public.properties order by id");
      const w = await tx.query<{ id: string }>("select id from public.work_orders order by id");
      expect(p.rows.map((r) => r.id)).toEqual(["recP4"]);
      expect(w.rows.map((r) => r.id)).toEqual(["recW4"]);
      await tx.rollback();
    }).catch((e) => { if (!/rollback/i.test(String(e))) throw e; });
  });

  it("with consent Pending sees nothing", async () => {
    await as(db, aal1(U.landlordC2), async (tx) => {
      expect(await ids(tx, "properties")).toEqual([]);
      expect(await ids(tx, "work_orders")).toEqual([]);
    });
  });

  it("loses access when consent changes to Declined", async () => {
    await db.transaction(async (tx) => {
      await tx.exec("update public.contacts set consent_status = 'Declined' where id = 'recC1'");
      await tx.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: U.landlordC1, aal: "aal1" }),
      ]);
      await tx.exec("set local role authenticated");
      const p = await tx.query("select id from public.properties");
      expect(p.rows).toEqual([]);
      await tx.rollback();
    }).catch((e) => { if (!/rollback/i.test(String(e))) throw e; });
  });

  it("cannot read contacts (including their own), agencies or suppliers", async () => {
    await as(db, aal1(U.landlordC1), async (tx) => {
      for (const t of ["contacts", "agencies", "supplier_orgs", "work_order_assignments", "sync_runs"]) {
        expect(await ids(tx, t), t).toEqual([]);
      }
    });
  });
});

describe("installer", () => {
  it("sees only work orders assigned to their organisation, and those properties", async () => {
    await as(db, aal1(U.installerS1), async (tx) => {
      expect(await ids(tx, "work_orders")).toEqual(["recW1"]);
      expect(await ids(tx, "properties")).toEqual(["recP1"]);
      expect(await ids(tx, "supplier_orgs")).toEqual(["recS1"]);
    });
    await as(db, aal1(U.installerS2), async (tx) => {
      expect(await ids(tx, "work_orders")).toEqual(["recW2"]);
      expect(await ids(tx, "properties")).toEqual(["recP2"]);
    });
  });

  it("an ended assignment gives no access", async () => {
    await as(db, aal1(U.installerS1), async (tx) => {
      expect(await ids(tx, "work_orders")).not.toContain("recW2");
    });
  });

  it("cannot read landlord contact details or other suppliers", async () => {
    await as(db, aal1(U.installerS1), async (tx) => {
      expect(await ids(tx, "contacts")).toEqual([]);
      expect(await ids(tx, "supplier_orgs")).toEqual(["recS1"]);
      expect(await ids(tx, "agencies")).toEqual([]);
    });
  });
});

describe("everyone else", () => {
  it("a signed-in user with no profile sees nothing", async () => {
    await as(db, aal2(U.noProfile), async (tx) => {
      for (const t of ALL_TABLES) expect(await ids(tx, t), t).toEqual([]);
    });
  });

  it("anon is refused outright", async () => {
    for (const t of ALL_TABLES) {
      await expect(as(db, "anon", (tx) => ids(tx, t)), t).rejects.toThrow(/permission denied/);
    }
  });

  it("no signed-in user can write, not even admin", async () => {
    const writes = [
      "insert into public.properties (id, address) values ('recX', 'x')",
      "update public.work_orders set pipeline_status = 'Invoice Paid'",
      "delete from public.contacts",
      "update public.profiles set role = 'admin'",
      "insert into public.sync_runs (trigger) values ('manual')",
    ];
    for (const sql of writes) {
      await expect(as(db, aal2(U.admin), (tx) => tx.exec(sql)), sql).rejects.toThrow(/permission denied/);
    }
  });
});

describe("schema", () => {
  it("has no cost, margin, price, quote or subsidy columns", async () => {
    const res = await db.query<{ col: string }>(`
      select table_name || '.' || column_name as col
      from information_schema.columns
      where table_schema = 'public'
        and column_name ~* '(cost|margin|price|quote|amount|subsidy|xero)'
    `);
    expect(res.rows).toEqual([]);
  });

  it("has RLS enabled on every public table", async () => {
    const res = await db.query<{ relname: string }>(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
    `);
    expect(res.rows).toEqual([]);
  });
});
