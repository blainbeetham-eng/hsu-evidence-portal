import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/dal";
import { formatDate, formatDateTime } from "@/lib/format";
import { AIRTABLE_BASE_ID, TABLES } from "@/lib/airtable/allowlist";
import { SUMMARY_FOOTER, looksLikeContactDetails } from "@/lib/summary";
import { GenerateSummaryButton, HideToggle, ImportButton, SummaryActions, UploadPanel } from "./assessment-client";

export const metadata = { title: "Property — HomeStar Evidence Portal" };
// Import from Drive and AI summaries run inside this page's server actions.
export const maxDuration = 300;

const SIGNED_URL_SECONDS = 600; // short-lived links (security spec S5)
const LANDLORD_CONSENT_OK = ["Granted", "Agency Notified"];

type EvidenceFile = {
  id: string; work_order_id: string; kind: "report" | "photo" | "video"; storage_path: string; poster_path: string | null;
  file_name: string; mime: string | null; size_bytes: number | null; source: string; taken_at: string | null;
  duration_s: number | null; hidden: boolean; created_at: string;
};
type Summary = {
  id: string; report_id: string; version: number; body: string; status: string; source: string; model: string | null;
  created_at: string; approved_at: string | null;
};

export default async function PropertyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const preview = (await searchParams).view === "landlord";
  const supabase = await createClient();

  const { data: p } = await supabase.from("properties").select("*").eq("id", id).maybeSingle();
  if (!p) notFound();

  const { data: wos } = await supabase
    .from("work_orders")
    .select("id, activity_type, pipeline_status, source_order_ref, landlord_ids, is_test, removed_at, drive_folder_url")
    .eq("property_id", id)
    .order("activity_type");
  const workOrders = wos ?? [];
  const woIds = workOrders.map((w) => w.id);

  const usesCurrentLandlord = p.current_landlord_ids.length > 0;
  const landlordIds: string[] = usesCurrentLandlord
    ? p.current_landlord_ids
    : [...new Set(workOrders.filter((w) => !w.removed_at).flatMap((w) => w.landlord_ids as string[]))];

  const [{ data: agency }, { data: landlords }, { data: fileRows }] = await Promise.all([
    p.agency_id ? supabase.from("agencies").select("name").eq("id", p.agency_id).maybeSingle() : Promise.resolve({ data: null }),
    landlordIds.length
      ? supabase.from("contacts").select("id, name, email, consent_status, removed_at").in("id", landlordIds)
      : Promise.resolve({ data: [] as { id: string; name: string | null; email: string | null; consent_status: string | null; removed_at: string | null }[] }),
    woIds.length
      ? supabase.from("evidence_files").select("*").in("work_order_id", woIds).eq("stage", "assessment").is("deleted_at", null)
          .order("taken_at", { ascending: true, nullsFirst: false }).order("created_at")
      : Promise.resolve({ data: [] as EvidenceFile[] }),
  ]);

  // In preview, show exactly what the landlord's own access would show (the same rules as RLS).
  const allFiles = (fileRows ?? []) as EvidenceFile[];
  const files = preview ? allFiles.filter((f) => !f.hidden) : allFiles;
  const reports = files.filter((f) => f.kind === "report");
  const photos = files.filter((f) => f.kind === "photo");
  const videos = files.filter((f) => f.kind === "video");

  const reportIds = reports.map((r) => r.id);
  const [{ data: summaryRows }, { data: extras }] = await Promise.all([
    reportIds.length
      ? supabase.from("report_summaries").select("*").in("report_id", reportIds).order("version", { ascending: false })
      : Promise.resolve({ data: [] as Summary[] }),
    reportIds.length && !preview
      ? supabase.from("report_extras").select("report_id, di_report_url").in("report_id", reportIds)
      : Promise.resolve({ data: [] as { report_id: string; di_report_url: string | null }[] }),
  ]);
  const summaries = (summaryRows ?? []) as Summary[];
  const diLink = new Map((extras ?? []).map((e) => [e.report_id, e.di_report_url]));

  // Short-lived links: originals, plus small resized copies for photo thumbnails.
  const paths = files.flatMap((f) => [f.storage_path, ...(f.poster_path ? [f.poster_path] : [])]);
  const { data: signed } = paths.length
    ? await supabase.storage.from("evidence").createSignedUrls(paths, SIGNED_URL_SECONDS)
    : { data: [] };
  const url = new Map<string, string>((signed ?? []).flatMap((s) => (s.path && s.signedUrl ? [[s.path, s.signedUrl] as [string, string]] : [])));
  const thumbs = new Map(
    await Promise.all(
      photos
        .filter((f) => f.mime === "image/jpeg" || f.mime === "image/png" || f.mime === "image/webp")
        .map(async (f) => {
          const { data } = await supabase.storage
            .from("evidence")
            .createSignedUrl(f.storage_path, SIGNED_URL_SECONDS, { transform: { width: 480, height: 360, resize: "cover" } });
          return [f.id, data?.signedUrl ?? null] as const;
        }),
    ),
  );

  const landlordCanSee = (landlords ?? []).some((c) => !c.removed_at && LANDLORD_CONSENT_OK.includes(c.consent_status ?? ""));
  const driveFolders = [
    ...new Map(workOrders.filter((w) => w.drive_folder_url && !w.removed_at).map((w) => [w.drive_folder_url, w])).values(),
  ];
  const woLabel = new Map(workOrders.map((w) => [w.id, w.activity_type ?? "Work order"]));
  const airtableUrl = `https://airtable.com/${AIRTABLE_BASE_ID}/${TABLES.properties.tableId}/${p.id}`;

  return (
    <>
      <p className="small"><Link href="/properties">← Properties</Link></p>
      <div className="row spread">
        <h1>{p.address}</h1>
        {preview
          ? <Link className="button secondary" href={`/properties/${id}`}>Back to admin view</Link>
          : <Link className="button secondary" href={`/properties/${id}?view=landlord`}>Preview as landlord</Link>}
      </div>

      {preview && (
        <div className={`banner ${landlordCanSee ? "warn" : "bad"}`}>
          {landlordCanSee
            ? "Preview: this is what the landlord and agency see. Nothing here is visible to them until landlord logins open (Phase 3)."
            : "Preview only. The landlord couldn't see this page today: no landlord with consent Granted or Agency Notified."}
        </div>
      )}
      {p.removed_at && <div className="banner bad">This property was removed from Airtable on {formatDateTime(p.removed_at)}.</div>}

      <dl className="facts">
        <dt>Agency</dt><dd>{agency?.name ?? "—"}</dd>
        {!preview && <><dt>Property type</dt><dd>{p.property_type ?? "—"}</dd></>}
        <dt>Lease renewal date</dt>
        <dd>
          {formatDate(p.lease_renewal_date_override ?? p.lease_renewal_date)}
          {!preview && p.lease_renewal_date_override && <span className="muted small"> (portal override; Airtable says {formatDate(p.lease_renewal_date)})</span>}
          {!p.lease_renewal_date && !p.lease_renewal_date_override && <span className="muted small"> Not set. Which standards apply will show once it is.</span>}
        </dd>
        {!preview && <><dt>Last synced</dt><dd>{formatDateTime(p.synced_at)}</dd></>}
        {!preview && <><dt>Airtable</dt><dd><a href={airtableUrl} target="_blank" rel="noreferrer">Open record</a></dd></>}
      </dl>

      <h2>Assessment</h2>

      {!preview && (
        <div className="stack">
          {driveFolders.length > 0 ? (
            driveFolders.map((w) => (
              <ImportButton
                key={w.id}
                propertyId={id}
                workOrderId={w.id}
                label={driveFolders.length > 1 ? `Import from Drive (${w.source_order_ref ?? w.activity_type})` : "Import from Drive"}
              />
            ))
          ) : (
            <p className="muted small">No Drive folder link on this property&rsquo;s work orders in Airtable.</p>
          )}
          <details>
            <summary>Upload files</summary>
            <UploadPanel
              propertyId={id}
              workOrders={workOrders.filter((w) => !w.removed_at).map((w) => ({ id: w.id, label: `${w.activity_type ?? "Work order"}${w.source_order_ref ? ` (${w.source_order_ref})` : ""}` }))}
            />
          </details>
        </div>
      )}

      {reports.length === 0 && photos.length === 0 && videos.length === 0 && (
        <p className="muted">{preview ? "No assessment yet." : "No assessment files yet. Import from Drive or upload them."}</p>
      )}

      {reports.map((r) => {
        const versions = summaries.filter((s) => s.report_id === r.id);
        const approved = versions.find((s) => s.status === "approved");
        const latest = versions[0];
        const shown = preview ? approved : latest;
        return (
          <section key={r.id} className="card stack">
            <div className="row spread">
              <div>
                <strong>Assessment report</strong>{" "}
                <span className="muted small">{r.file_name}</span>
                {!preview && r.hidden && <> <span className="tag bad">hidden</span></>}
              </div>
              <div className="row">
                {url.get(r.storage_path) && <a href={url.get(r.storage_path)} target="_blank" rel="noreferrer">Open report (PDF)</a>}
                {!preview && diLink.get(r.id) && <a href={diLink.get(r.id)!} target="_blank" rel="noreferrer">Open DI report (photos, video)</a>}
                {!preview && <HideToggle propertyId={id} fileId={r.id} hidden={r.hidden} />}
              </div>
            </div>

            {shown ? (
              <div className="summary">
                {!preview && (
                  <p className="small">
                    <span className={`tag ${shown.status === "approved" ? "" : shown.status === "draft" ? "warn" : "bad"}`}>
                      {shown.status === "approved" ? "Approved: landlord and agency see this" : shown.status === "draft" ? "Draft: not visible to landlord" : shown.status}
                    </span>{" "}
                    <span className="muted">
                      Version {shown.version}, {shown.source === "manual" ? "edited by you" : `AI (${shown.model ?? "unknown model"})`}, {formatDateTime(shown.created_at)}
                      {approved && approved.id !== shown.id && ` · Version ${approved.version} is the approved one`}
                    </span>
                  </p>
                )}
                {!preview && looksLikeContactDetails(shown.body) && (
                  <div className="banner warn small">This summary may contain an email address or phone number. Remove it before approving.</div>
                )}
                <p className="pre">{shown.body}</p>
                <p className="muted small">{SUMMARY_FOOTER}</p>
                {!preview && (
                  <SummaryActions propertyId={id} summaryId={shown.id} reportId={r.id} status={shown.status} body={shown.body} />
                )}
              </div>
            ) : (
              !preview && <div className="small"><p className="muted">No summary yet.</p><GenerateSummaryButton propertyId={id} reportId={r.id} /></div>
            )}
          </section>
        );
      })}

      {photos.length > 0 && (
        <>
          <h3>Assessment photos</h3>
          <div className="photo-grid">
            {photos.map((f) => (
              <figure key={f.id} className={f.hidden ? "is-hidden" : ""}>
                <a href={url.get(f.storage_path)} target="_blank" rel="noreferrer">
                  {thumbs.get(f.id)
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={thumbs.get(f.id)!} alt={f.file_name} loading="lazy" />
                    : <span className="no-thumb">{f.mime === "image/heic" || f.mime === "image/heif" ? "iPhone photo (HEIC): open to view" : "Open photo"}</span>}
                </a>
                <figcaption className="small muted">
                  {f.taken_at ? formatDateTime(f.taken_at) : "Date not recorded"}
                  {!preview && <> · <HideToggle propertyId={id} fileId={f.id} hidden={f.hidden} />{f.hidden && " (hidden)"}</>}
                </figcaption>
              </figure>
            ))}
          </div>
        </>
      )}

      {videos.length > 0 && (
        <>
          <h3>Assessment video</h3>
          {videos.map((v) => (
            <figure key={v.id} className={`video ${v.hidden ? "is-hidden" : ""}`}>
              {/* Never preloads: the video downloads only when played. */}
              <video controls preload="none" poster={v.poster_path ? url.get(v.poster_path) : undefined} src={url.get(v.storage_path)} />
              <figcaption className="small muted">
                {v.duration_s ? `${Math.round(Number(v.duration_s))} seconds · ` : ""}
                <a href={url.get(v.storage_path)} target="_blank" rel="noreferrer">Download</a>
                {!preview && <> · <HideToggle propertyId={id} fileId={v.id} hidden={v.hidden} />{v.hidden && " (hidden)"}</>}
              </figcaption>
            </figure>
          ))}
        </>
      )}

      {!preview && (
        <>
          <h2>Landlord access</h2>
          <p className="muted small">
            {usesCurrentLandlord
              ? "Taken from the property's Current Landlord in Airtable."
              : "No Current Landlord on the property, so taken from the Landlord on its work orders."}
            {" "}A landlord can see the property only while Consent Status is Granted or Agency Notified (landlord logins open in Phase 3).
          </p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Email</th><th>Consent</th></tr></thead>
              <tbody>
                {(landlords ?? []).map((c) => (
                  <tr key={c.id}>
                    <td>{c.name ?? "—"}{c.removed_at && <> <span className="tag bad">removed</span></>}</td>
                    <td>{c.email ?? "—"}</td>
                    <td><span className={`tag ${LANDLORD_CONSENT_OK.includes(c.consent_status ?? "") ? "" : c.consent_status === "Declined" ? "bad" : "warn"}`}>{c.consent_status ?? "Unknown"}</span></td>
                  </tr>
                ))}
                {landlords?.length === 0 && <tr><td colSpan={3} className="muted">No landlord linked in Airtable.</td></tr>}
              </tbody>
            </table>
          </div>

          <h2>Work orders</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Upgrade</th><th>Pipeline status</th><th>Source order ref</th><th></th></tr></thead>
              <tbody>
                {workOrders.map((w) => (
                  <tr key={w.id}>
                    <td>{woLabel.get(w.id)}</td>
                    <td>{w.pipeline_status ?? "—"}</td>
                    <td>{w.source_order_ref ?? "—"}</td>
                    <td>
                      {w.is_test && <span className="tag warn">test data</span>}{" "}
                      {w.removed_at && <span className="tag bad">removed</span>}
                    </td>
                  </tr>
                ))}
                {workOrders.length === 0 && <tr><td colSpan={4} className="muted">No work orders.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
