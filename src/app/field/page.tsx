import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { templateFor } from "@/lib/checklists";

type Job = { work_order_id: string; activity_type: string | null; pipeline_status: string | null; address: string; assigned_at: string };

export default async function FieldJobs() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("field_jobs");
  const jobs = (data ?? []) as Job[];
  return (
    <>
      <h1>Your jobs</h1>
      {jobs.length === 0 && <p className="muted">No jobs right now. HSU will add them here.</p>}
      <div className="stack">
        {jobs.map((j) => (
          <Link key={j.work_order_id} href={`/field/${j.work_order_id}`} className="card" style={{ textDecoration: "none", color: "inherit" }}>
            <strong>{j.address}</strong>
            <div className="small muted">{j.activity_type ?? "Job"}{!templateFor(j.activity_type) && " (no checklist yet)"}</div>
          </Link>
        ))}
      </div>
      <p className="muted small">
        Tip: add this page to your home screen (Share, then Add to Home Screen) to open it like an app.
      </p>
    </>
  );
}
