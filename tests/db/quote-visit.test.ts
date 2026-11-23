// Quote visit (23 Nov 2026): job-level answers are admin only, and quote photos (hidden)
// never reach landlords or agencies. Same harness as rls.test.ts.
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, createTestDb, type Claims } from "./harness";

const U = {
  admin: "00000000-0000-0000-0000-000000000001",
  agency1: "00000000-0000-0000-0000-000000000002",
  landlordC1: "00000000-0000-0000-0000-000000000004",
  field: "00000000-0000-0000-0000-000000000008",
};
const HASH = "a".repeat(64);

const SEED = `
  insert into auth.users (id) values ${Object.values(U).map((id) => `('${id}')`).join(",")};
  insert into public.agencies (id, name) values ('recA1', 'Agency One');
  insert into public.contacts (id, name, email, consent_status) values ('recC1', 'Landlord One', 'one@example.com', 'Granted');
  insert into public.properties (id, address, agency_id, current_landlord_ids) values ('recP1', '1 One St', 'recA1', '{recC1}');
  insert into public.work_orders (id, property_id, activity_type) values ('recW1', 'recP1', 'Draughtproofing');
  insert into public.profiles (id, role, agency_id, contact_id, supplier_org_id) values
    ('${U.admin}', 'admin', null, null, null),
    ('${U.agency1}', 'agency_user', 'recA1', null, null),
    ('${U.landlordC1}', 'landlord', null, 'recC1', null),
    ('${U.field}', 'field_team', null, null, null);
  insert into public.field_assignments (work_order_id, assigned_by) values ('recW1', '${U.admin}');
  insert into public.quote_visits (work_order_id, template, template_version, answers) values
    ('recW1', 'draughtproofing', '2026-11-23', '{"note": "gas heater in lounge"}');
  insert into public.evidence_files (work_order_id, kind, stage, storage_path, file_name, sha256, source, hidden, checklist_key, uploaded_by) values
    ('recW1', 'photo', 'assessment', 'recW1/quote-1.jpg', 'quote-1.jpg', '${HASH}', 'admin_upload', true, 'quote', '${U.admin}');
  insert into storage.objects (bucket_id, name) values ('evidence', 'recW1/quote-1.jpg');
`;

let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
  await db.exec(SEED);
});

const aal2 = (sub: string): Claims => ({ sub, aal: "aal2" });
const aal1 = (sub: string): Claims => ({ sub, aal: "aal1" });

describe("quote visit", () => {
  it("admin with MFA reads and writes the job answers", async () => {
    await as(db, aal2(U.admin), async (tx) => {
      const r = await tx.query("select answers from public.quote_visits");
      expect(r.rows).toHaveLength(1);
      await tx.exec(`update public.quote_visits set answers = '{"note": "updated"}' where work_order_id = 'recW1'`);
    });
  });

  it("admin without MFA, field team, landlord and agency can't see the answers", async () => {
    for (const c of [aal1(U.admin), aal1(U.field), aal2(U.landlordC1), aal2(U.agency1)]) {
      await as(db, c, async (tx) => {
        const r = await tx.query("select * from public.quote_visits");
        expect(r.rows).toHaveLength(0);
      });
    }
  });

  it("hidden quote photos stay away from landlord, agency and field team", async () => {
    for (const c of [aal2(U.landlordC1), aal2(U.agency1), aal1(U.field)]) {
      await as(db, c, async (tx) => {
        expect((await tx.query("select id from public.evidence_files where checklist_key = 'quote'")).rows).toHaveLength(0);
        expect((await tx.query("select name from storage.objects where name = 'recW1/quote-1.jpg'")).rows).toHaveLength(0);
      });
    }
    await as(db, aal2(U.admin), async (tx) => {
      expect((await tx.query("select id from public.evidence_files where checklist_key = 'quote'")).rows).toHaveLength(1);
    });
  });
});
