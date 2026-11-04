import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/dal";
import { formatDateTime } from "@/lib/format";
import { FileInbox } from "./inbox-client";
import type { Found } from "./actions";

export const metadata = { title: "Inbox — HomeStar Evidence Portal" };

type Item = {
  id: string; received_at: string; from_email: string | null; from_name: string | null; subject: string | null; body_text: string | null;
  supplier_org_id: string | null; suggested_property_id: string | null; suggested_work_order_id: string | null; status: string;
  filed_work_order_id: string | null; filed_by: string | null; filed_at: string | null; discard_reason: string | null; skipped: string[];
};

/** Emails received at the email-in address that need filing (spec v0.8 item 4). */
export default async function InboxPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [{ data: open }, { data: recent }] = await Promise.all([
    supabase.from("inbox_items").select("*").eq("status", "new").order("received_at"),
    supabase.from("inbox_items").select("*").neq("status", "new").order("received_at", { ascending: false }).limit(20),
  ]);
  const items = (open ?? []) as Item[];
  const done = (recent ?? []) as Item[];

  const ids = [...items, ...done].map((i) => i.id);
  const { data: files } = ids.length
    ? await supabase.from("evidence_files").select("id, inbox_item_id, storage_path, file_name, kind, mime").in("inbox_item_id", ids).is("deleted_at", null)
    : { data: [] as { id: string; inbox_item_id: string; storage_path: string; file_name: string; kind: string; mime: string | null }[] };
  const { data: signed } = files?.length
    ? await supabase.storage.from("evidence").createSignedUrls(files.map((f) => f.storage_path), 600)
    : { data: [] };
  const url = new Map((signed ?? []).flatMap((s) => (s.path && s.signedUrl ? [[s.path, s.signedUrl] as [string, string]] : [])));

  const propIds = [...new Set([...items, ...done].flatMap((i) => [i.suggested_property_id]).filter(Boolean) as string[])];
  const woIds = [...new Set(done.map((i) => i.filed_work_order_id).filter(Boolean) as string[])];
  const [{ data: props }, { data: suppliers }, { data: propWos }, { data: filedWos }] = await Promise.all([
    propIds.length ? supabase.from("properties").select("id, address").in("id", propIds) : Promise.resolve({ data: [] as { id: string; address: string }[] }),
    supabase.from("supplier_orgs").select("id, name"),
    propIds.length ? supabase.from("work_orders").select("id, property_id, activity_type, source_order_ref").in("property_id", propIds).is("removed_at", null)
      : Promise.resolve({ data: [] as { id: string; property_id: string; activity_type: string | null; source_order_ref: string | null }[] }),
    woIds.length ? supabase.from("work_orders").select("id, property_id, activity_type").in("id", woIds) : Promise.resolve({ data: [] as { id: string; property_id: string; activity_type: string | null }[] }),
  ]);
  const address = new Map((props ?? []).map((p) => [p.id, p.address]));
  const supplierName = new Map((suppliers ?? []).map((s) => [s.id, s.name]));
  const filedWo = new Map((filedWos ?? []).map((w) => [w.id, w]));

  const initialFound = (i: Item): Found => {
    if (!i.suggested_property_id) return null;
    const wos = (propWos ?? []).filter((w) => w.property_id === i.suggested_property_id);
    const sorted = [...wos].sort((a, b) => (a.id === i.suggested_work_order_id ? -1 : b.id === i.suggested_work_order_id ? 1 : 0));
    return {
      propertyId: i.suggested_property_id,
      address: address.get(i.suggested_property_id) ?? "",
      workOrders: sorted.map((w) => ({ id: w.id, label: `${w.activity_type ?? "Work order"}${w.source_order_ref ? ` (${w.source_order_ref})` : ""}` })),
    };
  };

  const Files = ({ itemId }: { itemId: string }) => {
    const fs = (files ?? []).filter((f) => f.inbox_item_id === itemId);
    if (!fs.length) return <p className="muted small">No files kept.</p>;
    return (
      <ul className="small">
        {fs.map((f) => <li key={f.id}><a href={url.get(f.storage_path)} target="_blank" rel="noreferrer">{f.file_name}</a> <span className="muted">{f.kind}</span></li>)}
      </ul>
    );
  };

  return (
    <>
      <h1>Inbox</h1>
      <p className="muted small">
        Emails sent to the email-in address that couldn&rsquo;t be filed automatically: the sender isn&rsquo;t a known
        supplier email, or the subject&rsquo;s address didn&rsquo;t match one job. Files stay hidden from landlords and
        agencies until you file them and accept them on the property page.
      </p>

      {items.length === 0 && <p className="muted">Nothing to file.</p>}
      {items.map((i) => (
        <section key={i.id} className="card stack">
          <div className="row spread">
            <strong>{i.subject || "(no subject)"}</strong>
            <span className="muted small">{formatDateTime(i.received_at)}</span>
          </div>
          <p className="small">
            From {i.from_name ? `${i.from_name} ` : ""}{i.from_email ?? "unknown"}
            {i.supplier_org_id ? <> · <span className="tag">supplier: {supplierName.get(i.supplier_org_id) ?? i.supplier_org_id}</span></> : <> · <span className="tag warn">not a known supplier email</span></>}
          </p>
          {i.body_text && (
            <details><summary className="small">Email text</summary><p className="pre small">{i.body_text.slice(0, 3000)}</p></details>
          )}
          <Files itemId={i.id} />
          {i.skipped.length > 0 && <p className="small muted">Not kept: {i.skipped.join("; ")}</p>}
          <FileInbox itemId={i.id} initialAddress={i.suggested_property_id ? address.get(i.suggested_property_id) ?? "" : ""} initial={initialFound(i)} />
        </section>
      ))}

      <h2>Recently filed or discarded</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Received</th><th>From</th><th>Subject</th><th>Outcome</th></tr></thead>
          <tbody>
            {done.map((i) => {
              const w = i.filed_work_order_id ? filedWo.get(i.filed_work_order_id) : null;
              return (
                <tr key={i.id}>
                  <td>{formatDateTime(i.received_at)}</td>
                  <td>{i.from_email}</td>
                  <td>{i.subject}</td>
                  <td className="small">
                    {i.status === "filed" && w
                      ? <>Filed {i.filed_by ? "by you" : "automatically"} to <Link href={`/properties/${w.property_id}`}>{w.activity_type ?? "work order"}</Link></>
                      : i.status === "discarded" ? `Discarded: ${i.discard_reason}` : i.status}
                  </td>
                </tr>
              );
            })}
            {done.length === 0 && <tr><td colSpan={4} className="muted">None yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
