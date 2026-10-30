// Phase 2A: who can read and write assessment files, report summaries and the files
// in Storage. Same harness as rls.test.ts (PGlite, SET ROLE authenticated + JWT claims).
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { as, createTestDb, type Claims } from "./harness";

const U = {
  admin: "00000000-0000-0000-0000-000000000001",
  agency1: "00000000-0000-0000-0000-000000000002",
  agency2: "00000000-0000-0000-0000-000000000003",
  landlordC1: "00000000-0000-0000-0000-000000000004",
  landlordC2: "00000000-0000-0000-0000-000000000005",
  installerS1: "00000000-0000-0000-0000-000000000007",
};
const HASH = "a".repeat(64);
const F = {
  report: "10000000-0000-0000-0000-000000000001", // W1 (P1, agency 1, landlord C1)
  photo: "10000000-0000-0000-0000-000000000002", // W1
  hiddenPhoto: "10000000-0000-0000-0000-000000000003", // W1, hidden
  deletedPhoto: "10000000-0000-0000-0000-000000000004", // W1, soft-deleted
  video: "10000000-0000-0000-0000-000000000005", // W1, with still image
  otherReport: "10000000-0000-0000-0000-000000000006", // W2 (P2, agency 2, landlord C2 Pending)
};

// Agency A1: P1 (landlord C1, Granted) with W1. Agency A2: P2 (landlord C2, Pending) with W2.
const SEED = `
  insert into auth.users (id) values ${Object.values(U).map((id) => `('${id}')`).join(",")};
  insert into public.agencies (id, name) values ('recA1', 'Agency One'), ('recA2', 'Agency Two');
  insert into public.contacts (id, name, consent_status) values
    ('recC1', 'Landlord One', 'Granted'), ('recC2', 'Landlord Two', 'Pending');
  insert into public.properties (id, address, agency_id, current_landlord_ids) values
    ('recP1', '1 One St', 'recA1', '{recC1}'), ('recP2', '2 Two St', 'recA2', '{recC2}');
  insert into public.work_orders (id, property_id, activity_type) values
    ('recW1', 'recP1', 'Insulation'), ('recW2', 'recP2', 'Draughtproofing');
  insert into public.work_order_assignments (work_order_id, supplier_org_id, source) values ('recW1', 'recS1', 'admin');
  insert into public.profiles (id, role, agency_id, contact_id, supplier_org_id) values
    ('${U.admin}', 'admin', null, null, null),
    ('${U.agency1}', 'agency_user', 'recA1', null, null),
    ('${U.agency2}', 'agency_user', 'recA2', null, null),
    ('${U.landlordC1}', 'landlord', null, 'recC1', null),
    ('${U.landlordC2}', 'landlord', null, 'recC2', null),
    ('${U.installerS1}', 'installer', null, null, 'recS1');

  insert into public.evidence_files (id, work_order_id, kind, storage_path, poster_path, file_name, sha256, source, hidden, deleted_at) values
    ('${F.report}', 'recW1', 'report', 'recW1/report.pdf', null, 'report.pdf', '${HASH}', 'drive_import', false, null),
    ('${F.photo}', 'recW1', 'photo', 'recW1/photo.jpg', null, 'photo.jpg', '${HASH}', 'drive_import', false, null),
    ('${F.hiddenPhoto}', 'recW1', 'photo', 'recW1/hidden.jpg', null, 'hidden.jpg', '${HASH}', 'drive_import', true, null),
    ('${F.deletedPhoto}', 'recW1', 'photo', 'recW1/deleted.jpg', null, 'deleted.jpg', '${HASH}', 'admin_upload', false, now()),
    ('${F.video}', 'recW1', 'video', 'recW1/roof.mp4', 'recW1/roof-poster.jpg', 'roof.mp4', '${HASH}', 'admin_upload', false, null),
    ('${F.otherReport}', 'recW2', 'report', 'recW2/report.pdf', null, 'report.pdf', '${HASH}', 'drive_import', false, null);
  insert into public.report_extras (report_id, di_report_url) values ('${F.report}', 'https://di.example/report/1');
  insert into public.report_summaries (report_id, version, body, status) values
    ('${F.report}', 1, 'old approved', 'superseded'),
    ('${F.report}', 2, 'current', 'approved'),
    ('${F.report}', 3, 'new draft', 'draft'),
    ('${F.otherReport}', 1, 'other property', 'approved');
  insert into storage.objects (bucket_id, name) values
    ('evidence', 'recW1/report.pdf'), ('evidence', 'recW1/photo.jpg'), ('evidence', 'recW1/hidden.jpg'),
    ('evidence', 'recW1/deleted.jpg'), ('evidence', 'recW1/roof.mp4'), ('evidence', 'recW1/roof-poster.jpg'),
    ('evidence', 'recW2/report.pdf'), ('evidence', 'orphan.jpg');
`;

let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
  await db.exec(SEED);
});

const aal2 = (sub: string): Claims => ({ sub, aal: "aal2" });

async function files(tx: Transaction) {
  const r = await tx.query<{ file_name: string; work_order_id: string }>(
    "select file_name, work_order_id from public.evidence_files order by work_order_id, file_name",
  );
  return r.rows.map((x) => `${x.work_order_id}/${x.file_name}`);
}
async function summaries(tx: Transaction) {
  const r = await tx.query<{ body: string }>("select body from public.report_summaries order by body");
  return r.rows.map((x) => x.body);
}
async function objects(tx: Transaction) {
  const r = await tx.query<{ name: string }>("select name from storage.objects order by name");
  return r.rows.map((x) => x.name);
}
async function fails(tx: Transaction, sql: string) {
  await tx.exec("savepoint s");
  try {
    await tx.exec(sql);
    return false;
  } catch {
    return true;
  } finally {
    await tx.exec("rollback to savepoint s");
  }
}

describe("admin", () => {
  it("sees every file, summary version, DI link and stored object", async () => {
    await as(db, aal2(U.admin), async (tx) => {
      expect(await files(tx)).toHaveLength(6);
      expect(await summaries(tx)).toEqual(["current", "new draft", "old approved", "other property"]);
      expect((await tx.query("select di_report_url from public.report_extras")).rows).toHaveLength(1);
      expect(await objects(tx)).toHaveLength(8);
    });
  });

  it("can record files, summaries and audit entries as themselves", async () => {
    await as(db, aal2(U.admin), async (tx) => {
      expect(await fails(tx, `insert into public.evidence_files (work_order_id, kind, storage_path, file_name, sha256, source, uploaded_by)
        values ('recW1', 'photo', 'recW1/new.jpg', 'new.jpg', '${HASH}', 'admin_upload', '${U.admin}')`)).toBe(false);
      expect(await fails(tx, `insert into public.report_summaries (report_id, version, body, created_by)
        values ('${F.report}', 4, 'x', '${U.admin}')`)).toBe(false);
      expect(await fails(tx, `insert into public.audit_log (actor, action) values ('${U.admin}', 'test')`)).toBe(false);
      expect(await fails(tx, `insert into storage.objects (bucket_id, name) values ('evidence', 'recW1/new.jpg')`)).toBe(false);
    });
  });

  it("gets the new row back when recording a file (INSERT ... RETURNING, as the app does)", async () => {
    await as(db, aal2(U.admin), async (tx) => {
      const r = await tx.query<{ id: string }>(`insert into public.evidence_files (work_order_id, kind, storage_path, file_name, sha256, source, uploaded_by)
        values ('recW1', 'report', 'recW1/returning.pdf', 'returning.pdf', '${HASH}', 'drive_import', '${U.admin}') returning id`);
      expect(r.rows).toHaveLength(1);
      const s = await tx.query(`insert into public.report_summaries (report_id, version, body, created_by)
        values ('${r.rows[0].id}', 1, 'x', '${U.admin}') returning id`);
      expect(s.rows).toHaveLength(1);
    });
  });

  it("cannot record an upload or audit entry under someone else's name", async () => {
    await as(db, aal2(U.admin), async (tx) => {
      expect(await fails(tx, `insert into public.evidence_files (work_order_id, kind, storage_path, file_name, sha256, source, uploaded_by)
        values ('recW1', 'photo', 'recW1/x.jpg', 'x.jpg', '${HASH}', 'admin_upload', '${U.agency1}')`)).toBe(true);
      expect(await fails(tx, `insert into public.audit_log (actor, action) values ('${U.agency1}', 'test')`)).toBe(true);
    });
  });

  it("cannot delete files, summaries or stored objects", async () => {
    await as(db, aal2(U.admin), async (tx) => {
      expect(await fails(tx, "delete from public.evidence_files")).toBe(true);
      expect(await fails(tx, "delete from public.report_summaries")).toBe(true);
      await tx.exec("delete from storage.objects"); // no delete policy: removes nothing
      expect(await files(tx)).toHaveLength(6);
      expect(await summaries(tx)).toHaveLength(4);
      expect(await objects(tx)).toHaveLength(8);
    });
  });

  it("can't approve two summaries of one report at once", async () => {
    await as(db, aal2(U.admin), async (tx) => {
      expect(await fails(tx, `update public.report_summaries set status = 'approved' where body = 'new draft'`)).toBe(true);
    });
  });

  it("without MFA sees nothing and writes nothing", async () => {
    await as(db, { sub: U.admin, aal: "aal1" }, async (tx) => {
      expect(await files(tx)).toEqual([]);
      expect(await objects(tx)).toEqual([]);
      expect(await fails(tx, `insert into storage.objects (bucket_id, name) values ('evidence', 'x.jpg')`)).toBe(true);
    });
  });
});

describe("landlord", () => {
  it("sees their property's visible files and only the approved summary", async () => {
    await as(db, aal2(U.landlordC1), async (tx) => {
      expect(await files(tx)).toEqual(["recW1/photo.jpg", "recW1/report.pdf", "recW1/roof.mp4"]);
      expect(await summaries(tx)).toEqual(["current"]);
    });
  });

  it("can open those files and the video's still image, but not hidden, deleted or other files", async () => {
    await as(db, aal2(U.landlordC1), async (tx) => {
      expect(await objects(tx)).toEqual(["recW1/photo.jpg", "recW1/report.pdf", "recW1/roof-poster.jpg", "recW1/roof.mp4"]);
    });
  });

  it("sees the DI report link for their own visible report, and can't change it", async () => {
    await as(db, aal2(U.landlordC1), async (tx) => {
      expect((await tx.query("select di_report_url from public.report_extras")).rows).toHaveLength(1);
      expect(await fails(tx, `insert into public.report_extras (report_id, di_report_url) values ('${F.photo}', 'https://x')`)).toBe(true);
      await tx.exec("update public.report_extras set di_report_url = 'https://evil.example'");
      expect((await tx.query<{ u: string }>("select di_report_url as u from public.report_extras")).rows[0].u).toBe("https://di.example/report/1");
    });
  });

  it("loses the DI link when the report is hidden", async () => {
    await as(
      db,
      aal2(U.landlordC1),
      async (tx) => expect((await tx.query("select * from public.report_extras")).rows).toEqual([]),
      `update public.evidence_files set hidden = true where id = '${F.report}'`,
    );
  });

  it("with consent Pending sees nothing", async () => {
    await as(db, aal2(U.landlordC2), async (tx) => {
      expect(await files(tx)).toEqual([]);
      expect(await summaries(tx)).toEqual([]);
      expect(await objects(tx)).toEqual([]);
    });
  });

  it("loses the summary when the report is hidden", async () => {
    await as(
      db,
      aal2(U.landlordC1),
      async (tx) => {
        expect(await summaries(tx)).toEqual([]);
        expect(await objects(tx)).not.toContain("recW1/report.pdf");
      },
      `update public.evidence_files set hidden = true where id = '${F.report}'`,
    );
  });

  it("cannot write anything", async () => {
    await as(db, aal2(U.landlordC1), async (tx) => {
      expect(await fails(tx, `insert into public.evidence_files (work_order_id, kind, storage_path, file_name, sha256, source, uploaded_by)
        values ('recW1', 'photo', 'recW1/l.jpg', 'l.jpg', '${HASH}', 'admin_upload', '${U.landlordC1}')`)).toBe(true);
      expect(await fails(tx, `insert into storage.objects (bucket_id, name) values ('evidence', 'recW1/l.jpg')`)).toBe(true);
      await tx.exec(`update public.evidence_files set hidden = true; update public.report_summaries set status = 'approved' where body = 'new draft';`);
      expect(await files(tx)).toHaveLength(3);
      expect(await summaries(tx)).toEqual(["current"]);
    });
  });
});

describe("agency_user", () => {
  it("sees only its own agency's files and approved summaries", async () => {
    await as(db, aal2(U.agency1), async (tx) => {
      expect(await files(tx)).toEqual(["recW1/photo.jpg", "recW1/report.pdf", "recW1/roof.mp4"]);
      expect(await summaries(tx)).toEqual(["current"]);
      expect((await tx.query("select * from public.report_extras")).rows).toHaveLength(1);
    });
    await as(db, aal2(U.agency2), async (tx) => {
      expect(await files(tx)).toEqual(["recW2/report.pdf"]);
      expect(await summaries(tx)).toEqual(["other property"]);
      expect(await objects(tx)).toEqual(["recW2/report.pdf"]);
    });
  });
});

describe("installer and anon", () => {
  it("an installer cannot upload", async () => {
    await as(db, aal2(U.installerS1), async (tx) => {
      expect(await fails(tx, `insert into storage.objects (bucket_id, name) values ('evidence', 'recW1/i.jpg')`)).toBe(true);
    });
  });

  it("anon sees nothing", async () => {
    await as(db, "anon", async (tx) => {
      expect(await fails(tx, "select * from public.evidence_files")).toBe(true);
      expect(await objects(tx)).toEqual([]);
    });
  });
});

describe("bucket", () => {
  it("is private, 2 GB per file, and only takes reports, photos and videos", async () => {
    const r = await db.query<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(
      "select public, file_size_limit::text, allowed_mime_types from storage.buckets where id = 'evidence'",
    );
    expect(r.rows[0].public).toBe(false);
    expect(r.rows[0].file_size_limit).toBe("2147483648");
    expect(r.rows[0].allowed_mime_types).toContain("video/mp4");
    expect(r.rows[0].allowed_mime_types).not.toContain("text/html");
  });
});
