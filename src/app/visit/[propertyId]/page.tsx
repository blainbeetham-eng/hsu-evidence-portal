import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/dal";
import { QUOTE_PHOTO_KEY, quoteDefFor } from "@/lib/quote-visit";
import { VisitJob, type VisitPhoto } from "./visit-client";

const SIGNED_URL_SECONDS = 600;
const THUMBABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

export default async function QuoteVisitPage({ params }: { params: Promise<{ propertyId: string }> }) {
  await requireAdmin();
  const { propertyId } = await params;
  const supabase = await createClient();

  const { data: p } = await supabase.from("properties").select("id, address").eq("id", propertyId).maybeSingle();
  if (!p) notFound();
  const { data: wos } = await supabase
    .from("work_orders").select("id, activity_type, is_test").eq("property_id", propertyId).is("removed_at", null).order("activity_type");
  const jobs = (wos ?? []).map((w) => ({ ...w, def: quoteDefFor(w.activity_type) }));
  const ids = jobs.map((j) => j.id);

  const [{ data: items }, { data: visits }, { data: files }] = ids.length
    ? await Promise.all([
        supabase.from("job_items").select("id, work_order_id, kind, label, details").in("work_order_id", ids).is("removed_at", null).order("created_at"),
        supabase.from("quote_visits").select("work_order_id, answers").in("work_order_id", ids),
        supabase.from("evidence_files").select("id, work_order_id, job_item_id, storage_path, mime, taken_at")
          .in("work_order_id", ids).eq("checklist_key", QUOTE_PHOTO_KEY).is("deleted_at", null).order("created_at"),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  const photos: VisitPhoto[] = await Promise.all(
    (files ?? []).map(async (f) => {
      const { data } = await supabase.storage.from("evidence").createSignedUrl(
        f.storage_path, SIGNED_URL_SECONDS, THUMBABLE.has(f.mime ?? "") ? { transform: { width: 160, height: 160, resize: "cover" } } : undefined,
      );
      return { id: f.id, work_order_id: f.work_order_id, job_item_id: f.job_item_id, thumb: data?.signedUrl ?? null };
    }),
  );

  return (
    <>
      <p className="small"><Link href={`/properties/${propertyId}`}>← Property page</Link></p>
      <h1>{p.address}</h1>
      <p className="muted small">
        Quote visit: measurements and photos for each upgrade. Photos save on this phone first and upload when there&rsquo;s signal.
        They stay hidden from landlords and agencies.
      </p>
      {jobs.length === 0 && <p>No work orders at this property.</p>}
      <div className="stack">
        {jobs.map((j) =>
          j.def ? (
            <VisitJob
              key={j.id}
              propertyId={propertyId}
              workOrderId={j.id}
              def={j.def}
              items={(items ?? []).filter((i) => i.work_order_id === j.id && j.def!.itemKinds.some((k) => k.kind === i.kind))
                .map((i) => ({ id: i.id, kind: i.kind, label: i.label, details: (i.details ?? {}) as Record<string, string> }))}
              answers={((visits ?? []).find((v) => v.work_order_id === j.id)?.answers ?? {}) as Record<string, string>}
              photos={photos.filter((ph) => ph.work_order_id === j.id)}
            />
          ) : (
            <section key={j.id} className="card"><strong>{j.activity_type ?? "Work order"}</strong><p className="muted small">No quote checklist for this upgrade type yet.</p></section>
          ),
        )}
      </div>
    </>
  );
}
