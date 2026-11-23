import Link from "next/link";
import { formatDateTime } from "@/lib/format";
import { quoteDefFor, quoteValues, totals, visitText } from "@/lib/quote-visit";
import { CopyText } from "./quote-copy";
import type { JobItem } from "./works-section";

// Quote visit results on the property page (admin only, never in the landlord preview):
// per upgrade, the totals, the measurements as text to copy, and the visit photos.

export type QPhoto = { id: string; work_order_id: string; job_item_id: string | null; storage_path: string; file_name: string; mime: string | null; taken_at: string | null };

export function QuoteVisitSection({ propertyId, workOrders, items, answers, photos, url, thumbs }: {
  propertyId: string;
  workOrders: { id: string; activity_type: string | null; removed_at: string | null }[];
  items: JobItem[];
  answers: Map<string, Record<string, string>>;
  photos: QPhoto[];
  url: Map<string, string>;
  thumbs: Map<string, string | null>;
}) {
  const blocks = workOrders.filter((w) => !w.removed_at).flatMap((w) => {
    const def = quoteDefFor(w.activity_type);
    if (!def) return [];
    const its = items
      .filter((i) => i.work_order_id === w.id && !i.removed_at && def.itemKinds.some((k) => k.kind === i.kind))
      .map((i) => ({ id: i.id, kind: i.kind, label: i.label, details: i.details ?? {} }));
    const a = answers.get(w.id) ?? {};
    const ph = photos.filter((p) => p.work_order_id === w.id);
    const measured = its.some((i) => Object.keys(quoteValues(i.details)).length > 0) || Object.keys(a).length > 0;
    if (!measured && ph.length === 0 && its.length === 0) return [];
    return [{ w, def, its, a, ph }];
  });

  return (
    <>
      <h2>Quote visit</h2>
      <p className="small">
        <Link href={`/visit/${propertyId}`}>Open the quote visit page</Link>{" "}
        <span className="muted">(on your phone, to add measurements and photos). Only HSU sees this section.</span>
      </p>
      {blocks.length === 0 && <p className="muted">No quote visit recorded yet.</p>}
      {blocks.map(({ w, def, its, a, ph }) => {
        const label = new Map(its.map((i) => [i.id, i.label]));
        const sums = totals(def, its, a);
        const text = visitText(def, its, a);
        return (
          <section key={w.id} className="card stack">
            <strong>{def.title}</strong>
            {sums.length > 0 && (
              <dl className="facts small">
                {sums.map((t) => <span key={t.label} style={{ display: "contents" }}><dt>{t.label}</dt><dd>{t.value}</dd></span>)}
              </dl>
            )}
            <p className="pre small">{text}</p>
            <CopyText text={text} />
            {ph.length > 0 && (
              <div className="photo-grid">
                {ph.map((f) => (
                  <figure key={f.id}>
                    <a href={url.get(f.storage_path)} target="_blank" rel="noreferrer">
                      {thumbs.get(f.id)
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={thumbs.get(f.id)!} alt={f.file_name} loading="lazy" />
                        : <span className="no-thumb">{f.mime === "image/heic" || f.mime === "image/heif" ? "iPhone photo (HEIC): open to view" : "Open photo"}</span>}
                    </a>
                    <figcaption className="small muted">
                      {f.job_item_id ? label.get(f.job_item_id) ?? "Removed item" : "General"}
                      {f.taken_at ? ` · ${formatDateTime(f.taken_at)}` : ""}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}
