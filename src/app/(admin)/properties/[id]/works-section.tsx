import { formatDateTime } from "@/lib/format";
import { applicability } from "@/lib/applicability";
import { itemKind, statusLabel, templateFor, worksStage } from "@/lib/checklists";
import { FieldToggle, GenerateReportButton, NoteForm, RemoveNote, ReviewBar, ReviewOne, SlotPicker, StatusForm, SummaryEditor, type SlotOption } from "./works-client";
import { UploadPanel } from "./assessment-client";

// Works and Completion stages of the property page (spec 3C). Server component: the page
// fetches the rows (through RLS) and the short-lived file links, and passes them in.

export type WFile = {
  id: string; work_order_id: string | null; kind: string; stage: string; storage_path: string; file_name: string;
  mime: string | null; source: string; taken_at: string | null; created_at: string; hidden: boolean;
  review_status: string; review_note: string | null; phase: string | null; job_item_id: string | null;
  checklist_key: string | null; flags: string[]; geo_source: string | null; accuracy_m: number | null; received_from: string | null;
};
export type WOrder = { id: string; activity_type: string | null; pipeline_status: string | null; source_order_ref: string | null; removed_at: string | null };
export type JobItem = { id: string; work_order_id: string; kind: string; label: string; details: Record<string, string>; removed_at: string | null };
export type WSummary = { id: string; work_order_id: string | null; kind: string; version: number; body: string; status: string; created_at: string; published_at: string | null };
export type Note = { id: string; work_order_id: string | null; body: string; visibility: string; created_at: string };
export type UStatus = { work_order_id: string; status: string; exemption_ground: string | null; note: string | null; set_at: string };

const SOURCE: Record<string, string> = {
  field_capture: "HSU field team",
  email_in: "emailed in",
  admin_upload: "uploaded by HSU",
  drive_import: "from Drive",
};
const FLAG: Record<string, string> = {
  no_location: "no location",
  low_accuracy: "location approximate",
  old_capture: "taken over a day before upload",
};
const VIS: Record<string, string> = { internal: "Internal", agency: "Agency", agency_landlord: "Agency and landlord" };

type Ctx = {
  propertyId: string;
  preview: boolean;
  url: Map<string, string>;
  thumbs: Map<string, string | null>;
};

function Photo({ f, ctx, children }: { f: WFile; ctx: Ctx; children?: React.ReactNode }) {
  const flags = f.flags.map((x) => FLAG[x] ?? x);
  return (
    <figure className={f.hidden ? "is-hidden" : ""}>
      <a href={ctx.url.get(f.storage_path)} target="_blank" rel="noreferrer">
        {ctx.thumbs.get(f.id)
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={ctx.thumbs.get(f.id)!} alt={f.file_name} loading="lazy" />
          : <span className="no-thumb">{f.kind === "document" ? f.file_name : "Open photo"}</span>}
      </a>
      <figcaption className="small muted">
        {f.taken_at ? formatDateTime(f.taken_at) : `Received ${formatDateTime(f.created_at)}`}
        {!ctx.preview && <> · {SOURCE[f.source] ?? f.source}{f.received_from ? ` (${f.received_from})` : ""}</>}
        {!ctx.preview && flags.length > 0 && <> · <span className="tag warn">{flags.join(", ")}</span></>}
        {children}
      </figcaption>
    </figure>
  );
}

export function WorksStage(props: {
  ctx: Ctx;
  workOrders: WOrder[];
  files: WFile[];
  items: JobItem[];
  fieldAssigned: Set<string>;
  summaries: WSummary[];
  notes: Note[];
  leaseDate: string | null;
}) {
  const { ctx } = props;
  const active = props.workOrders.filter((w) => !w.removed_at);
  return (
    <>
      <h2>Works</h2>
      {!ctx.preview && (
        <details>
          <summary>Upload works photos or documents</summary>
          <UploadPanel
            propertyId={ctx.propertyId}
            stage="works"
            workOrders={active.map((w) => ({ id: w.id, label: `${w.activity_type ?? "Work order"}${w.source_order_ref ? ` (${w.source_order_ref})` : ""}` }))}
          />
        </details>
      )}
      {active.length === 0 && <p className="muted">No upgrades yet.</p>}
      {active.map((w) => (
        <WorkBlock
          key={w.id}
          ctx={ctx}
          wo={w}
          files={props.files.filter((f) => f.work_order_id === w.id)}
          items={props.items.filter((i) => i.work_order_id === w.id && !i.removed_at)}
          assigned={props.fieldAssigned.has(w.id)}
          summaries={props.summaries.filter((s) => s.kind === "works" && s.work_order_id === w.id)}
          notes={props.notes.filter((n) => n.work_order_id === w.id)}
          leaseDate={props.leaseDate}
        />
      ))}
    </>
  );
}

function WorkBlock({ ctx, wo, files, items, assigned, summaries, notes, leaseDate }: {
  ctx: Ctx; wo: WOrder; files: WFile[]; items: JobItem[]; assigned: boolean; summaries: WSummary[]; notes: Note[]; leaseDate: string | null;
}) {
  const t = templateFor(wo.activity_type);
  const app = applicability(wo.activity_type, leaseDate);
  const waiting = files.filter((f) => f.review_status === "pending" || f.review_status === "needs_more");
  const shown = files.filter((f) => f.review_status === "accepted" && (!ctx.preview || !f.hidden));
  const photos = shown.filter((f) => f.kind === "photo");
  const docs = shown.filter((f) => f.kind === "document");
  const loose = photos.filter((f) => !f.job_item_id && !t?.jobSlots.some((s) => s.key === f.checklist_key));
  const published = summaries.find((s) => s.status === "published");
  const latest = summaries[0] ?? null;
  const summary = ctx.preview ? published : latest;

  const slotOptions: SlotOption[] = [
    { value: "||before", label: "Before (no item)" },
    { value: "||during", label: "During (no item)" },
    { value: "||after", label: "After (no item)" },
    ...(t?.jobSlots ?? []).map((s) => ({ value: `|${s.key}|${s.phase}`, label: s.label })),
    ...items.flatMap((i) => (itemKind(t!, i.kind)?.slots ?? []).map((s) => ({ value: `${i.id}|${s.key}|${s.phase}`, label: `${i.label}: ${s.label}` }))),
  ];
  const slotValue = (f: WFile) => `${f.job_item_id ?? ""}|${f.job_item_id || t?.jobSlots.some((s) => s.key === f.checklist_key) ? f.checklist_key ?? "" : ""}|${f.phase ?? ""}`;

  return (
    <section className="card stack">
      <div className="row spread">
        <div>
          <strong>{wo.activity_type ?? "Upgrade"}</strong>{" "}
          <span className="tag">{worksStage(wo.pipeline_status)}</span>
          {!ctx.preview && <span className="muted small"> Pipeline: {wo.pipeline_status ?? "—"}</span>}
          {!ctx.preview && assigned && <> <span className="tag">field team job</span></>}
        </div>
        {!ctx.preview && <FieldToggle propertyId={ctx.propertyId} workOrderId={wo.id} assigned={assigned} />}
      </div>
      <p className="small muted">{app.text}</p>

      {(summary || !ctx.preview) && (
        <div className="summary">
          {summary && (
            <>
              {!ctx.preview && (
                <p className="small">
                  <span className={`tag ${summary.status === "published" ? "" : "warn"}`}>
                    {summary.status === "published" ? "Published" : "Draft: not visible to landlord"}
                  </span>{" "}
                  <span className="muted">Works summary, version {summary.version}, {formatDateTime(summary.created_at)}
                    {published && published.id !== summary.id && ` · version ${published.version} is published`}</span>
                </p>
              )}
              <p className="pre">{summary.body}</p>
            </>
          )}
          {!ctx.preview && (
            <SummaryEditor propertyId={ctx.propertyId} kind="works" workOrderId={wo.id} latest={latest} label="a works summary (optional)" />
          )}
        </div>
      )}

      {!ctx.preview && waiting.length > 0 && (
        <div className="banner warn stack">
          <strong>Waiting for your review ({waiting.length})</strong>
          <span className="small">Not visible to the landlord or agency until you accept.</span>
          <div className="photo-grid">
            {waiting.map((f) => (
              <Photo key={f.id} f={f} ctx={ctx}>
                <br />
                {itemName(f, items, t)}
                {f.review_status === "needs_more" && <><br /><span className="tag warn">asked for more: {f.review_note}</span></>}
                <br /><ReviewOne propertyId={ctx.propertyId} fileId={f.id} />
              </Photo>
            ))}
          </div>
          <ReviewBar propertyId={ctx.propertyId} fileIds={waiting.map((f) => f.id)} />
        </div>
      )}

      {t && (items.length > 0 || t.jobSlots.some((s) => photos.some((f) => f.checklist_key === s.key))) && (
        <div className="stack">
          {t.jobSlots.map((s) => {
            const ps = photos.filter((f) => !f.job_item_id && f.checklist_key === s.key);
            return ps.length ? (
              <div key={s.key}>
                <h4>{s.label}</h4>
                <div className="photo-grid">{ps.map((f) => <Photo key={f.id} f={f} ctx={ctx} />)}</div>
              </div>
            ) : null;
          })}
          {items.map((i) => {
            const k = itemKind(t, i.kind);
            const answered = (k?.fields ?? []).filter((fl) => i.details?.[fl.key]);
            return (
              <div key={i.id} className="checklist-item">
                <h4>{i.label} <span className="muted small">{k?.label}</span></h4>
                {answered.length > 0 && (
                  <p className="small">
                    {answered.map((fl) => `${fl.label}: ${fl.type === "yesno" ? (i.details[fl.key] === "yes" ? "Yes" : "No") : i.details[fl.key]}`).join(" · ")}
                  </p>
                )}
                <div className="pair">
                  {(k?.slots ?? []).map((s) => {
                    const ps = photos.filter((f) => f.job_item_id === i.id && f.checklist_key === s.key);
                    return (
                      <div key={s.key}>
                        <p className="small"><strong>{s.label}</strong></p>
                        {ps.length ? ps.map((f) => <Photo key={f.id} f={f} ctx={ctx} />) : <p className="muted small">No photo yet</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {loose.length > 0 && (
        <>
          {(["before", "during", "after", null] as const).map((ph) => {
            const ps = loose.filter((f) => f.phase === ph);
            if (!ps.length) return null;
            return (
              <div key={ph ?? "none"}>
                <h4>{ph ? ph[0].toUpperCase() + ph.slice(1) : "Other photos"}</h4>
                <div className="photo-grid">
                  {ps.map((f) => (
                    <Photo key={f.id} f={f} ctx={ctx}>
                      {!ctx.preview && <><br /><SlotPicker propertyId={ctx.propertyId} fileId={f.id} current={slotValue(f)} options={slotOptions} /></>}
                    </Photo>
                  ))}
                </div>
              </div>
            );
          })}
        </>
      )}

      {docs.length > 0 && (
        <div>
          <h4>Documents</h4>
          <ul>
            {docs.map((d) => (
              <li key={d.id}>
                <a href={ctx.url.get(d.storage_path)} target="_blank" rel="noreferrer">{d.file_name}</a>
                <span className="muted small"> {formatDateTime(d.created_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {photos.length === 0 && docs.length === 0 && waiting.length === 0 && (
        <p className="muted small">{ctx.preview ? "No works evidence yet." : "No works evidence yet. The field team, an emailed report or an upload will add it."}</p>
      )}

      <Notes ctx={ctx} notes={notes} workOrderId={wo.id} />
    </section>
  );
}

function itemName(f: WFile, items: JobItem[], t: ReturnType<typeof templateFor>) {
  const item = items.find((i) => i.id === f.job_item_id);
  const slot = item && t ? itemKind(t, item.kind)?.slots.find((s) => s.key === f.checklist_key) : t?.jobSlots.find((s) => s.key === f.checklist_key);
  if (item) return `${item.label}: ${slot?.label ?? f.phase ?? ""}`;
  if (slot) return slot.label;
  return f.phase ? f.phase[0].toUpperCase() + f.phase.slice(1) : f.kind === "document" ? "Document" : "Photo";
}

function Notes({ ctx, notes, workOrderId }: { ctx: Ctx; notes: Note[]; workOrderId: string | null }) {
  const shown = ctx.preview ? notes.filter((n) => n.visibility === "agency_landlord") : notes;
  if (ctx.preview && shown.length === 0) return null;
  return (
    <div className="stack">
      {shown.map((n) => (
        <div key={n.id} className="note small">
          {!ctx.preview && <span className={`tag ${n.visibility === "internal" ? "warn" : ""}`}>{VIS[n.visibility]}</span>}{" "}
          <span className="pre">{n.body}</span>{" "}
          <span className="muted">{formatDateTime(n.created_at)}</span>
          {!ctx.preview && <> · <RemoveNote propertyId={ctx.propertyId} noteId={n.id} /></>}
        </div>
      ))}
      {!ctx.preview && <NoteForm propertyId={ctx.propertyId} workOrderId={workOrderId} />}
    </div>
  );
}

export function CompletionStage(props: {
  ctx: Ctx;
  workOrders: WOrder[];
  statuses: UStatus[];
  summaries: WSummary[];
  notes: Note[];
  reports: { id: string; generated_at: string; url: string | null }[];
}) {
  const { ctx } = props;
  const active = props.workOrders.filter((w) => !w.removed_at);
  const completion = props.summaries.filter((s) => s.kind === "completion");
  const published = completion.find((s) => s.status === "published");
  const latest = completion[0] ?? null;
  const summary = ctx.preview ? published : latest;
  const latestStatus = (woId: string) => props.statuses.find((s) => s.work_order_id === woId);

  return (
    <>
      <h2>Completion</h2>
      <section className="card stack">
        {summary && (
          <div className="summary">
            {!ctx.preview && (
              <p className="small">
                <span className={`tag ${summary.status === "published" ? "" : "warn"}`}>
                  {summary.status === "published" ? "Published" : "Draft: not visible to landlord"}
                </span>{" "}
                <span className="muted">Completion summary, version {summary.version}, {formatDateTime(summary.created_at)}
                  {published && published.id !== summary.id && ` · version ${published.version} is published`}</span>
              </p>
            )}
            <p className="pre">{summary.body}</p>
          </div>
        )}
        {!ctx.preview && <SummaryEditor propertyId={ctx.propertyId} kind="completion" workOrderId={null} latest={latest} label="the completion summary" />}
        {ctx.preview && !summary && <p className="muted small">Completion summary not written yet.</p>}

        <div className="table-wrap">
          <table>
            <thead><tr><th>Upgrade</th><th>Compliance status</th><th></th></tr></thead>
            <tbody>
              {active.map((w) => {
                const s = latestStatus(w.id);
                return (
                  <tr key={w.id}>
                    <td>{w.activity_type ?? "Upgrade"}</td>
                    <td>
                      <span className={`tag ${s?.status === "evidenced_compliant" || s?.status === "exempt_recorded" ? "" : s?.status === "non_compliant" ? "bad" : "warn"}`}>
                        {statusLabel(s?.status)}
                      </span>
                      {s?.exemption_ground && <span className="small"> Ground: {s.exemption_ground}</span>}
                      {s?.note && <span className="small muted"> {s.note}</span>}
                      {s && !ctx.preview && <span className="small muted"> · set {formatDateTime(s.set_at)}</span>}
                    </td>
                    <td>{!ctx.preview && <StatusForm propertyId={ctx.propertyId} workOrderId={w.id} current={s?.status ?? null} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted small">Evidence record only. Not a certificate of compliance.</p>
        {props.reports.length > 0 && (
          <p>
            <a href={props.reports[0].url ?? undefined} target="_blank" rel="noreferrer">Completion report (PDF)</a>
            <span className="muted small"> {formatDateTime(props.reports[0].generated_at)}</span>
            {!ctx.preview && props.reports.length > 1 && <span className="muted small"> · {props.reports.length - 1} earlier version{props.reports.length > 2 ? "s" : ""} kept</span>}
          </p>
        )}
        {!ctx.preview && (
          <>
            <GenerateReportButton propertyId={ctx.propertyId} />
            <p className="muted small">Uses published summaries, the statuses you set and accepted evidence only. Generate it again after changes; earlier versions are kept.</p>
          </>
        )}
        <Notes ctx={ctx} notes={props.notes.filter((n) => !n.work_order_id)} workOrderId={null} />
      </section>
    </>
  );
}
