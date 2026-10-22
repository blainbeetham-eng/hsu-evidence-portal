import { AIRTABLE_BASE_ID, TABLES, fieldIds, type TableKey } from "./allowlist";

export type AirtableRecord = {
  id: string;
  createdTime: string;
  fields: Record<string, unknown>;
};

export class UnexpectedFieldsError extends Error {
  constructor(public readonly fields: string[]) {
    super(`Airtable returned fields outside the allowlist: ${fields.join(", ")}`);
  }
}

const API = "https://api.airtable.com/v0";
const MAX_RETRIES = 2;

/**
 * Fetch every record of one table, asking only for allowlisted fields.
 * Throws UnexpectedFieldsError if Airtable returns anything else.
 */
export async function fetchTable(
  table: TableKey,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AirtableRecord[]> {
  const { tableId } = TABLES[table];
  const allowed = new Set(fieldIds(table));
  const records: AirtableRecord[] = [];
  let offset: string | undefined;

  do {
    const params = new URLSearchParams({ pageSize: "100", returnFieldsByFieldId: "true" });
    for (const id of allowed) params.append("fields[]", id);
    if (offset) params.set("offset", offset);

    const page = await getWithRetry(`${API}/${AIRTABLE_BASE_ID}/${tableId}?${params}`, token, fetchImpl);
    records.push(...page.records);
    offset = page.offset;
  } while (offset);

  const unexpected = new Set<string>();
  for (const r of records) {
    for (const key of Object.keys(r.fields)) if (!allowed.has(key)) unexpected.add(`${tableId}.${key}`);
  }
  if (unexpected.size) throw new UnexpectedFieldsError([...unexpected].sort());

  return records;
}

async function getWithRetry(
  url: string,
  token: string,
  fetchImpl: typeof fetch,
): Promise<{ records: AirtableRecord[]; offset?: string }> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (res.ok) return res.json();
    // Airtable asks clients to wait 30 seconds after a 429.
    if (res.status === 429 && attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, 30_000));
      continue;
    }
    const body = await res.text().catch(() => "");
    throw new Error(`Airtable ${res.status} for ${new URL(url).pathname}: ${body.slice(0, 300)}`);
  }
}
