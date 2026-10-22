import { describe, expect, it } from "vitest";
import { FORBIDDEN_FIELD_IDS, FORBIDDEN_TABLE_IDS, TABLES, fieldIds, type TableKey } from "@/lib/airtable/allowlist";

const tables = Object.keys(TABLES) as TableKey[];

describe("Airtable allowlist", () => {
  it("never requests the Supplier quotes table", () => {
    for (const t of tables) expect(FORBIDDEN_TABLE_IDS).not.toContain(TABLES[t].tableId);
  });

  it("never requests a cost, margin, price, quote or subsidy field", () => {
    for (const t of tables) {
      for (const id of fieldIds(t)) expect(FORBIDDEN_FIELD_IDS, `${t}.${id}`).not.toContain(id);
    }
  });

  it("uses no field key whose name suggests money", () => {
    for (const t of tables) {
      for (const key of Object.keys(TABLES[t].fields)) {
        expect(key, `${t}.${key}`).not.toMatch(/cost|margin|price|quote|amount|subsidy|invoice|xero/i);
      }
    }
  });

  it("has well-formed, unique Airtable IDs", () => {
    const all = tables.flatMap(fieldIds);
    for (const id of all) expect(id).toMatch(/^fld[A-Za-z0-9]{14}$/);
    expect(new Set(all).size).toBe(all.length);
    for (const t of tables) expect(TABLES[t].tableId).toMatch(/^tbl[A-Za-z0-9]{14}$/);
  });
});
