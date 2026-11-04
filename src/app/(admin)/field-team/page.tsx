import Link from "next/link";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/dal";
import { formatDateTime } from "@/lib/format";
import { AccessToggle, AddFieldUser } from "./field-team-client";

export const metadata = { title: "Field team — HomeStar Evidence Portal" };

export default async function FieldTeamPage() {
  await requireAdmin();
  const supabase = await createClient();
  const { data: people } = await supabase.from("profiles").select("id, full_name, created_at").eq("role", "field_team").order("created_at");

  // Emails, last sign-in and on/off state live in Supabase Auth (secret key, admin only).
  const admin = createServiceClient();
  const auth = await Promise.all((people ?? []).map((p) => admin.auth.admin.getUserById(p.id)));
  const user = new Map(auth.map((r) => [r.data.user?.id, r.data.user]));

  const { data: jobs } = await supabase.rpc("field_jobs");

  return (
    <>
      <h1>Field team</h1>
      <p className="muted small">
        HSU&rsquo;s draughtproofing and showerhead team. Each person has their own login and signs in on their phone
        with an email link (no authenticator app). They see only jobs you give to the field team, with the address and
        upgrade only: no landlord details, no prices. Their photos wait for your review.
      </p>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Last signed in</th><th>Access</th></tr></thead>
          <tbody>
            {(people ?? []).map((p) => {
              const u = user.get(p.id);
              const off = !!u?.banned_until && new Date(u.banned_until) > new Date();
              return (
                <tr key={p.id}>
                  <td>{p.full_name ?? "—"}</td>
                  <td>{u?.email ?? "—"}</td>
                  <td>{formatDateTime(u?.last_sign_in_at)}</td>
                  <td><span className={`tag ${off ? "bad" : ""}`}>{off ? "Off" : "On"}</span> <AccessToggle userId={p.id} on={!off} /></td>
                </tr>
              );
            })}
            {people?.length === 0 && <tr><td colSpan={4} className="muted">No one yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <AddFieldUser />

      <h2>Jobs on the field team&rsquo;s list</h2>
      <p className="muted small">Give a job to the field team from its property page (Works stage).</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Address</th><th>Upgrade</th><th>Pipeline</th><th>Given</th></tr></thead>
          <tbody>
            {(jobs ?? []).map((j: { work_order_id: string; property_id: string; address: string; activity_type: string | null; pipeline_status: string | null; assigned_at: string }) => (
              <tr key={j.work_order_id}>
                <td><Link href={`/properties/${j.property_id}`}>{j.address}</Link></td>
                <td>{j.activity_type ?? "—"}</td>
                <td>{j.pipeline_status ?? "—"}</td>
                <td>{formatDateTime(j.assigned_at)}</td>
              </tr>
            ))}
            {(jobs ?? []).length === 0 && <tr><td colSpan={4} className="muted">No jobs given to the field team.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="small"><Link href="/field">Open the field team&rsquo;s phone view</Link></p>
    </>
  );
}
