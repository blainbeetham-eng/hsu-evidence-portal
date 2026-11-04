// Phase 2B: field team, review states, Inbox, compliance status, written summaries and
// notes. Same harness as rls.test.ts (PGlite, SET ROLE authenticated + JWT claims).
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
  field: "00000000-0000-0000-0000-000000000008",
  field2: "00000000-0000-0000-0000-000000000009",
};
const HASH = "a".repeat(64);
const ITEM = "20000000-0000-0000-0000-000000000001";
const INBOX = "30000000-0000-0000-0000-000000000001";

// P1 (agency 1, landlord C1 Granted): W1 Insulation, W3 Draughtproofing (field team job).
// P2 (agency 2, landlord C2 Pending): W2 Draughtproofing (not a field team job).
const SEED = `
  insert into auth.users (id) values ${Object.values(U).map((id) => `('${id}')`).join(",")};
  insert into public.agencies (id, name) values ('recA1', 'Agency One'), ('recA2', 'Agency Two');
  insert into public.contacts (id, name, email, consent_status) values
    ('recC1', 'Landlord One', 'one@example.com', 'Granted'), ('recC2', 'Landlord Two', 'two@example.com', 'Pending');
  insert into public.properties (id, address, agency_id, current_landlord_ids) values
    ('recP1', '1 One St', 'recA1', '{recC1}'), ('recP2', '2 Two St', 'recA2', '{recC2}');
  insert into public.work_orders (id, property_id, activity_type, ai_job_summary) values
    ('recW1', 'recP1', 'Insulation', 'Landlord One, 0400 000 000'),
    ('recW3', 'recP1', 'Draughtproofing', 'Landlord One, 0400 000 000'),
    ('recW2', 'recP2', 'Draughtproofing', null);
  insert into public.work_order_assignments (work_order_id, supplier_org_id, source) values ('recW1', 'recS1', 'admin');
  insert into public.profiles (id, role, agency_id, contact_id, supplier_org_id) values
    ('${U.admin}', 'admin', null, null, null),
    ('${U.agency1}', 'agency_user', 'recA1', null, null),
    ('${U.agency2}', 'agency_user', 'recA2', null, null),
    ('${U.landlordC1}', 'landlord', null, 'recC1', null),
    ('${U.landlordC2}', 'landlord', null, 'recC2', null),
    ('${U.installerS1}', 'installer', null, null, 'recS1'),
    ('${U.field}', 'field_team', null, null, null),
    ('${U.field2}', 'field_team', null, null, null);
  insert into public.field_assignments (work_order_id, assigned_by) values ('recW3', '${U.admin}');
  insert into public.job_items (id, work_order_id, template, kind, label, created_by) values
    ('${ITEM}', 'recW3', 'draughtproofing', 'door', 'Front door', '${U.field}');
  insert into public.inbox_items (id, from_email, subject) values ('${INBOX}', 'someone@example.com', 'Photos');

  insert into public.evidence_files (work_order_id, inbox_item_id, kind, stage, storage_path, file_name, sha256, source, review_status, uploaded_by, job_item_id) values
    ('recW1', null, 'report', 'assessment', 'recW1/report.pdf', 'report.pdf', '${HASH}', 'drive_import', 'accepted', '${U.admin}', null),
    ('recW3', null, 'photo', 'works', 'recW3/accepted.jpg', 'accepted.jpg', '${HASH}', 'field_capture', 'accepted', '${U.field}', null),
    ('recW3', null, 'photo', 'works', 'recW3/pending.jpg', 'pending.jpg', '${HASH}', 'field_capture', 'pending', '${U.field}', null),
    ('recW3', null, 'photo', 'works', 'recW3/draft.jpg', 'draft.jpg', '${HASH}', 'field_capture', 'draft', '${U.field}', '${ITEM}'),
    ('recW3', null, 'photo', 'works', 'recW3/needs.jpg', 'needs.jpg', '${HASH}', 'field_capture', 'needs_more', '${U.field}', null),
    ('recW3', null, 'photo', 'works', 'recW3/rejected.jpg', 'rejected.jpg', '${HASH}', 'email_in', 'rejected', null, null),
    (null, '${INBOX}', 'photo', 'works', 'inbox/${INBOX}/a.jpg', 'a.jpg', '${HASH}', 'email_in', 'pending', null, null);
  insert into storage.objects (bucket_id, name) values
    ('evidence', 'recW1/report.pdf'), ('evidence', 'recW3/accepted.jpg'), ('evidence', 'recW3/pending.jpg'),
    ('evidence', 'recW3/draft.jpg'), ('evidence', 'recW3/needs.jpg'), ('evidence', 'recW3/rejected.jpg'),
    ('evidence', 'inbox/${INBOX}/a.jpg');

  insert into public.upgrade_status (work_order_id, status, set_by) values ('recW3', 'evidenced_compliant', '${U.admin}');
  insert into public.written_summaries (property_id, work_order_id, kind, version, body, status) values
    ('recP1', 'recW3', 'works', 1, 'works published', 'published'),
    ('recP1', 'recW3', 'works', 2, 'works draft', 'draft'),
    ('recP1', null, 'completion', 1, 'completion draft', 'draft'),
    ('recP2', null, 'completion', 1, 'other completion', 'published');
  insert into public.notes (property_id, body, visibility, deleted_at) values
    ('recP1', 'internal note', 'internal', null),
    ('recP1', 'agency note', 'agency', null),
    ('recP1', 'shared note', 'agency_landlord', null),
    ('recP1', 'deleted note', 'agency_landlord', now()),
    ('recP2', 'other shared', 'agency_landlord', null);
`;

let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
  await db.exec(SEED);
});

const aal2 = (sub: string): Claims => ({ sub, aal: "aal2" });
const aal1 = (sub: string): Claims => ({ sub, aal: "aal1" });

async function col(tx: Transaction, sql: string): Promise<string[]> {
  const r = await tx.query<{ v: string }>(sql);
  return r.rows.map((x) => x.v);
}
const fileNames = (tx: Transaction) => col(tx, "select file_name as v from public.evidence_files order by file_name");
const objectNames = (tx: Transaction) => col(tx, "select name as v from storage.objects order by name");
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
const fieldPhoto = (wo: string, name: string, extra = "") =>
  `insert into public.evidence_files (work_order_id, kind, stage, storage_path, file_name, sha256, source, review_status, uploaded_by${extra ? ", " + extra.split("=")[0] : ""})
   values ('${wo}', 'photo', 'works', '${wo}/${name}', '${name}', '${HASH}', 'field_capture', 'draft', '${U.field}'${extra ? ", " + extra.split("=")[1] : ""})`;

describe("field team", () => {
  it("sees its jobs with address and upgrade only, without MFA", async () => {
    await as(db, aal1(U.field), async (tx) => {
      const jobs = await tx.query<Record<string, unknown>>("select * from public.field_jobs()");
      expect(jobs.rows).toHaveLength(1);
      expect(jobs.rows[0]).toMatchObject({ work_order_id: "recW3", address: "1 One St", activity_type: "Draughtproofing" });
      expect(Object.keys(jobs.rows[0]).sort()).toEqual(
        ["activity_type", "address", "assigned_at", "pipeline_status", "property_id", "work_order_id"],
      );
    });
  });

  it("can't read landlords, properties, work orders (AI summary), agencies, notes, summaries or status", async () => {
    await as(db, aal1(U.field), async (tx) => {
      for (const t of ["contacts", "properties", "work_orders", "agencies", "notes", "written_summaries", "upgrade_status", "inbox_items"]) {
        expect((await tx.query(`select * from public.${t}`)).rows, t).toEqual([]);
      }
    });
  });

  it("sees only its own captures on its jobs, never the assessment or email-in files", async () => {
    await as(db, aal1(U.field), async (tx) => {
      expect(await fileNames(tx)).toEqual(["accepted.jpg", "draft.jpg", "needs.jpg", "pending.jpg"]);
      expect(await objectNames(tx)).toEqual(["recW3/accepted.jpg", "recW3/draft.jpg", "recW3/needs.jpg", "recW3/pending.jpg"]);
    });
    await as(db, aal1(U.field2), async (tx) => expect(await fileNames(tx)).toEqual([]));
  });

  it("adds draft photos to its own jobs only", async () => {
    await as(db, aal1(U.field), async (tx) => {
      expect(await fails(tx, fieldPhoto("recW3", "new.jpg"))).toBe(false);
      expect(await fails(tx, `insert into storage.objects (bucket_id, name) values ('evidence', 'recW3/new.jpg')`)).toBe(false);
      expect(await fails(tx, fieldPhoto("recW2", "x.jpg"))).toBe(true);
      expect(await fails(tx, `insert into storage.objects (bucket_id, name) values ('evidence', 'recW2/x.jpg')`)).toBe(true);
      expect(await fails(tx, `insert into storage.objects (bucket_id, name) values ('evidence', 'inbox/x.jpg')`)).toBe(true);
    });
  });

  it("can't add a photo as accepted, as someone else, or on a different path", async () => {
    await as(db, aal1(U.field), async (tx) => {
      expect(await fails(tx, fieldPhoto("recW3", "a.jpg").replace("'draft'", "'accepted'"))).toBe(true);
      expect(await fails(tx, fieldPhoto("recW3", "b.jpg").replace(`'${U.field}'`, `'${U.admin}'`))).toBe(true);
      expect(await fails(tx, fieldPhoto("recW3", "c.jpg").replace("'recW3/c.jpg'", "'recW2/c.jpg'"))).toBe(true);
      expect(await fails(tx, fieldPhoto("recW3", "d.jpg").replace("'field_capture'", "'admin_upload'"))).toBe(true);
    });
  });

  it("gets the new row back when recording a capture (INSERT ... RETURNING)", async () => {
    await as(db, aal1(U.field), async (tx) => {
      expect((await tx.query(fieldPhoto("recW3", "ret.jpg") + " returning id")).rows).toHaveLength(1);
    });
  });

  it("can't change, accept or delete evidence directly", async () => {
    await as(db, aal1(U.field), async (tx) => {
      await tx.exec("update public.evidence_files set review_status = 'accepted', hidden = false");
      expect(await col(tx, "select review_status as v from public.evidence_files where file_name = 'draft.jpg'")).toEqual(["draft"]);
      expect(await fails(tx, "delete from public.evidence_files")).toBe(true);
      expect(await fails(tx, `insert into public.upgrade_status (work_order_id, status, set_by) values ('recW3', 'evidenced_compliant', '${U.field}')`)).toBe(true);
    });
  });

  it("submits drafts for review; after that it can't discard them", async () => {
    await as(db, aal1(U.field), async (tx) => {
      const draft = (await tx.query<{ id: string }>("select id from public.evidence_files where file_name = 'draft.jpg'")).rows[0].id;
      expect((await tx.query<{ n: number }>("select public.submit_field_job('recW3') as n")).rows[0].n).toBe(1);
      expect(await col(tx, "select review_status as v from public.evidence_files where file_name = 'draft.jpg'")).toEqual(["pending"]);
      expect((await tx.query<{ ok: boolean }>(`select public.discard_field_photo('${draft}') as ok`)).rows[0].ok).toBe(false);
    });
  });

  it("can discard its own draft before submitting", async () => {
    await as(db, aal1(U.field), async (tx) => {
      const draft = (await tx.query<{ id: string }>("select id from public.evidence_files where file_name = 'draft.jpg'")).rows[0].id;
      expect((await tx.query<{ ok: boolean }>(`select public.discard_field_photo('${draft}') as ok`)).rows[0].ok).toBe(true);
    });
  });

  it("can't submit a job that isn't its own", async () => {
    await as(db, aal1(U.field), async (tx) => expect(await fails(tx, "select public.submit_field_job('recW2')")).toBe(true));
  });

  it("adds checklist items and answers on its jobs only; items with accepted photos are locked", async () => {
    await as(db, aal1(U.field), async (tx) => {
      expect(await fails(tx, `insert into public.job_items (work_order_id, template, kind, label, created_by) values ('recW3', 'draughtproofing', 'window', 'Bed 1', '${U.field}')`)).toBe(false);
      expect(await fails(tx, `insert into public.job_items (work_order_id, template, kind, label, created_by) values ('recW2', 'draughtproofing', 'window', 'Bed 1', '${U.field}')`)).toBe(true);
      expect(await fails(tx, `insert into public.job_checklists (work_order_id, template, template_version, answers, updated_by) values ('recW3', 'draughtproofing', 'v1', '{}', '${U.field}')`)).toBe(false);
      expect(await fails(tx, `insert into public.job_checklists (work_order_id, template, template_version, answers, updated_by) values ('recW2', 'draughtproofing', 'v1', '{}', '${U.field}')`)).toBe(true);
    });
    await as(
      db,
      aal1(U.field),
      async (tx) => {
        await tx.exec(`update public.job_items set label = 'Changed' where id = '${ITEM}'`);
        expect(await col(tx, `select label as v from public.job_items where id = '${ITEM}'`)).toEqual(["Front door"]);
      },
      `update public.evidence_files set review_status = 'accepted' where file_name = 'draft.jpg'`,
    );
  });

  it("loses everything when the job is unassigned", async () => {
    await as(
      db,
      aal1(U.field),
      async (tx) => {
        expect((await tx.query("select * from public.field_jobs()")).rows).toEqual([]);
        expect(await fileNames(tx)).toEqual([]);
        expect(await objectNames(tx)).toEqual([]);
        expect((await tx.query("select * from public.job_items")).rows).toEqual([]);
        expect(await fails(tx, fieldPhoto("recW3", "late.jpg"))).toBe(true);
      },
      "update public.field_assignments set ended_at = now()",
    );
  });

  it("a landlord or agency user can't use field team functions", async () => {
    await as(db, aal2(U.agency1), async (tx) => {
      expect((await tx.query("select * from public.field_jobs()")).rows).toEqual([]);
      expect(await fails(tx, "select public.submit_field_job('recW3')")).toBe(true);
    });
  });
});

describe("review states and the Inbox", () => {
  it("landlord and agency see only accepted works photos, never drafts, pending, needs-more, rejected or Inbox files", async () => {
    for (const who of [U.landlordC1, U.agency1]) {
      await as(db, aal2(who), async (tx) => {
        expect(await fileNames(tx)).toEqual(["accepted.jpg", "report.pdf"]);
        expect(await objectNames(tx)).toEqual(["recW1/report.pdf", "recW3/accepted.jpg"]);
      });
    }
  });

  it("an installer never sees Inbox files or HSU's field jobs", async () => {
    await as(db, aal2(U.installerS1), async (tx) => {
      expect(await fileNames(tx)).toEqual(["report.pdf"]);
      expect((await tx.query("select * from public.inbox_items")).rows).toEqual([]);
    });
  });

  it("admin sees everything, and files an Inbox item by setting its work order", async () => {
    await as(db, aal2(U.admin), async (tx) => {
      expect(await fileNames(tx)).toHaveLength(7);
      expect((await tx.query("select * from public.inbox_items")).rows).toHaveLength(1);
      await tx.exec(`update public.evidence_files set work_order_id = 'recW3', review_status = 'accepted' where inbox_item_id = '${INBOX}'`);
      await tx.exec(`update public.inbox_items set status = 'filed', filed_work_order_id = 'recW3' where id = '${INBOX}'`);
      expect(await col(tx, "select status as v from public.inbox_items")).toEqual(["filed"]);
    });
  });

  it("a file needs a work order or an Inbox item", async () => {
    await as(db, aal2(U.admin), async (tx) => {
      expect(await fails(tx, `insert into public.evidence_files (kind, storage_path, file_name, sha256, source, uploaded_by)
        values ('photo', 'loose.jpg', 'loose.jpg', '${HASH}', 'admin_upload', '${U.admin}')`)).toBe(true);
    });
  });
});

describe("compliance status, summaries and notes", () => {
  it("landlord sees the published works summary and status, not drafts; shared notes only", async () => {
    await as(db, aal2(U.landlordC1), async (tx) => {
      expect(await col(tx, "select body as v from public.written_summaries order by body")).toEqual(["works published"]);
      expect(await col(tx, "select status as v from public.upgrade_status")).toEqual(["evidenced_compliant"]);
      expect(await col(tx, "select body as v from public.notes order by body")).toEqual(["shared note"]);
    });
  });

  it("agency sees agency and shared notes for its own properties only", async () => {
    await as(db, aal2(U.agency1), async (tx) => {
      expect(await col(tx, "select body as v from public.notes order by body")).toEqual(["agency note", "shared note"]);
      expect(await col(tx, "select body as v from public.written_summaries order by body")).toEqual(["works published"]);
    });
    await as(db, aal2(U.agency2), async (tx) => {
      expect(await col(tx, "select body as v from public.notes order by body")).toEqual(["other shared"]);
      expect(await col(tx, "select body as v from public.written_summaries order by body")).toEqual(["other completion"]);
    });
  });

  it("a landlord with consent Pending sees no summaries, status or notes", async () => {
    await as(db, aal2(U.landlordC2), async (tx) => {
      expect((await tx.query("select * from public.written_summaries")).rows).toEqual([]);
      expect((await tx.query("select * from public.notes")).rows).toEqual([]);
      expect((await tx.query("select * from public.upgrade_status")).rows).toEqual([]);
    });
  });

  it("an installer sees no notes", async () => {
    await as(db, aal2(U.installerS1), async (tx) => expect((await tx.query("select * from public.notes")).rows).toEqual([]));
  });

  it("only admin writes status, summaries and notes; nobody can delete them", async () => {
    await as(db, aal2(U.agency1), async (tx) => {
      expect(await fails(tx, `insert into public.notes (property_id, body, author) values ('recP1', 'x', '${U.agency1}')`)).toBe(true);
      expect(await fails(tx, `insert into public.written_summaries (property_id, kind, version, body, written_by) values ('recP1', 'completion', 9, 'x', '${U.agency1}')`)).toBe(true);
      await tx.exec("update public.written_summaries set body = 'hacked'");
      expect(await col(tx, "select body as v from public.written_summaries")).toEqual(["works published"]);
    });
    await as(db, aal2(U.admin), async (tx) => {
      expect(await fails(tx, `insert into public.notes (property_id, body, author) values ('recP1', 'x', '${U.admin}')`)).toBe(false);
      expect(await fails(tx, `insert into public.upgrade_status (work_order_id, status, set_by) values ('recW1', 'non_compliant', '${U.admin}')`)).toBe(false);
      expect(await fails(tx, "delete from public.notes")).toBe(true);
      expect(await fails(tx, "delete from public.upgrade_status")).toBe(true);
      expect(await fails(tx, "update public.upgrade_status set status = 'non_compliant'")).toBe(true);
    });
  });

  it("only one published version of a summary at a time", async () => {
    await as(db, aal2(U.admin), async (tx) => {
      expect(await fails(tx, "update public.written_summaries set status = 'published' where body = 'works draft'")).toBe(true);
    });
  });

  it("admin without MFA sees nothing", async () => {
    await as(db, aal1(U.admin), async (tx) => {
      expect((await tx.query("select * from public.notes")).rows).toEqual([]);
      expect((await tx.query("select * from public.field_jobs()")).rows).toEqual([]);
    });
  });
});

describe("completion reports", () => {
  const setup = `
    insert into public.completion_reports (property_id, storage_path, sha256) values
      ('recP1', 'reports/recP1/completion-1.pdf', '${HASH}'), ('recP2', 'reports/recP2/completion-1.pdf', '${HASH}');
    insert into storage.objects (bucket_id, name) values
      ('evidence', 'reports/recP1/completion-1.pdf'), ('evidence', 'reports/recP2/completion-1.pdf');`;
  const reports = (tx: Transaction) => col(tx, "select storage_path as v from public.completion_reports order by storage_path");
  const reportObjects = async (tx: Transaction) => (await objectNames(tx)).filter((n) => n.startsWith("reports/"));

  it("landlord and agency see their own property's report and file only", async () => {
    for (const who of [U.landlordC1, U.agency1]) {
      await as(db, aal2(who), async (tx) => {
        expect(await reports(tx)).toEqual(["reports/recP1/completion-1.pdf"]);
        expect(await reportObjects(tx)).toEqual(["reports/recP1/completion-1.pdf"]);
      }, setup);
    }
  });

  it("a landlord with consent Pending, the field team and installers see none", async () => {
    for (const who of [aal2(U.landlordC2), aal1(U.field), aal2(U.installerS1)]) {
      await as(db, who, async (tx) => {
        expect(await reports(tx)).toEqual([]);
        expect(await reportObjects(tx)).toEqual([]);
      }, setup);
    }
  });

  it("only admin can record one", async () => {
    await as(db, aal2(U.agency1), async (tx) => {
      expect(await fails(tx, `insert into public.completion_reports (property_id, storage_path, sha256, generated_by) values ('recP1', 'x.pdf', '${HASH}', '${U.agency1}')`)).toBe(true);
    });
    await as(db, aal2(U.admin), async (tx) => {
      expect(await fails(tx, `insert into public.completion_reports (property_id, storage_path, sha256, generated_by) values ('recP1', 'x.pdf', '${HASH}', '${U.admin}')`)).toBe(false);
    });
  });
});
