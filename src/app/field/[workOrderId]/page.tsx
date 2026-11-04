import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { templateFor } from "@/lib/checklists";
import { FieldJob, type ServerPhoto } from "./field-client";

type Job = { work_order_id: string; activity_type: string | null; address: string };

export default async function FieldJobPage({ params }: { params: Promise<{ workOrderId: string }> }) {
  const { workOrderId } = await params;
  const supabase = await createClient();
  const { data: jobs } = await supabase.rpc("field_jobs");
  const job = ((jobs ?? []) as Job[]).find((j) => j.work_order_id === workOrderId);
  if (!job) notFound();
  const template = templateFor(job.activity_type);

  const { data: { user } } = await supabase.auth.getUser();
  const [{ data: items }, { data: checklist }, { data: files }] = await Promise.all([
    supabase.from("job_items").select("id, kind, label, details").eq("work_order_id", workOrderId).is("removed_at", null).order("created_at"),
    supabase.from("job_checklists").select("answers").eq("work_order_id", workOrderId).maybeSingle(),
    // Own captures only (admin opening this page sees just their own too).
    supabase.from("evidence_files")
      .select("id, storage_path, job_item_id, checklist_key, review_status, review_note, mime, flags")
      .eq("work_order_id", workOrderId).eq("source", "field_capture").eq("uploaded_by", user!.id).is("deleted_at", null)
      .order("created_at"),
  ]);

  const thumbs = await Promise.all(
    (files ?? []).map(async (f) => {
      const transformable = f.mime === "image/jpeg" || f.mime === "image/png" || f.mime === "image/webp";
      const { data } = await supabase.storage.from("evidence").createSignedUrl(
        f.storage_path, 600, transformable ? { transform: { width: 160, height: 160, resize: "cover" } } : undefined,
      );
      return { ...f, thumb: data?.signedUrl ?? null } as ServerPhoto;
    }),
  );

  return (
    <>
      <p className="small"><Link href="/field">← Your jobs</Link></p>
      <h1>{job.address}</h1>
      <p className="muted">{job.activity_type}</p>
      {template ? (
        <FieldJob
          workOrderId={workOrderId}
          template={template}
          items={(items ?? []) as { id: string; kind: string; label: string; details: Record<string, string> }[]}
          answers={(checklist?.answers ?? {}) as Record<string, string>}
          photos={thumbs}
        />
      ) : (
        <p>There&rsquo;s no checklist for this upgrade yet. Email photos to HSU instead.</p>
      )}
    </>
  );
}
