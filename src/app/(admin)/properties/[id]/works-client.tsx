"use client";
import { useState, useTransition } from "react";
import type { ActionResult } from "./actions";
import { COMPLIANCE_STATUSES } from "@/lib/checklists";
import {
  addNote,
  fileToSlot,
  generateCompletionReport,
  publishSummary,
  removeNote,
  reviewFiles,
  saveSummary,
  setFieldAssignment,
  setUpgradeStatus,
} from "./works-actions";

function Result({ r }: { r: ActionResult | null }) {
  if (!r) return null;
  return <p className={`small ${r.ok ? "muted" : "error"}`} role="status">{r.message}</p>;
}

function useAction() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const run = (fn: () => Promise<ActionResult>) => start(async () => setResult(await fn()));
  return { pending, result, run };
}

export function FieldToggle({ propertyId, workOrderId, assigned }: { propertyId: string; workOrderId: string; assigned: boolean }) {
  const { pending, result, run } = useAction();
  return (
    <span>
      <button className="secondary" disabled={pending} onClick={() => run(() => setFieldAssignment(propertyId, workOrderId, !assigned))}>
        {assigned ? "Remove from field team" : "Give to field team"}
      </button>
      <Result r={result} />
    </span>
  );
}

/** Accept, ask for more, or reject a group of files waiting for review. */
export function ReviewBar({ propertyId, fileIds }: { propertyId: string; fileIds: string[] }) {
  const { pending, result, run } = useAction();
  const [note, setNote] = useState("");
  return (
    <div className="stack">
      <div className="row">
        <button disabled={pending} onClick={() => run(() => reviewFiles(propertyId, fileIds, "accepted", note))}>
          Accept {fileIds.length > 1 ? `all ${fileIds.length}` : ""}
        </button>
        <input
          type="text"
          placeholder="What's missing, or why rejected"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={{ flex: 1, minWidth: 180 }}
        />
        <button className="secondary" disabled={pending} onClick={() => run(() => reviewFiles(propertyId, fileIds, "needs_more", note))}>Needs more</button>
        <button className="secondary" disabled={pending} onClick={() => run(() => reviewFiles(propertyId, fileIds, "rejected", note))}>Reject</button>
      </div>
      <Result r={result} />
    </div>
  );
}

export function ReviewOne({ propertyId, fileId }: { propertyId: string; fileId: string }) {
  const { pending, result, run } = useAction();
  return (
    <>
      <button className="link" disabled={pending} onClick={() => run(() => reviewFiles(propertyId, [fileId], "accepted", ""))}>Accept</button>
      {" · "}
      <button
        className="link"
        disabled={pending}
        onClick={() => {
          const why = window.prompt("Why is this photo rejected?");
          if (why) run(() => reviewFiles(propertyId, [fileId], "rejected", why));
        }}
      >
        Reject
      </button>
      {result && !result.ok && <Result r={result} />}
    </>
  );
}

export type SlotOption = { value: string; label: string };

/** File an uploaded or emailed photo into a checklist slot (value "itemId|slotKey|phase"). */
export function SlotPicker({ propertyId, fileId, current, options }: { propertyId: string; fileId: string; current: string; options: SlotOption[] }) {
  const { pending, result, run } = useAction();
  return (
    <>
      <select
        className="small"
        value={current}
        disabled={pending}
        onChange={(e) => {
          const [item, key, phase] = e.target.value.split("|");
          run(() => fileToSlot(propertyId, fileId, (phase || null) as "before" | "during" | "after" | null, item || null, key || null));
        }}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {result && !result.ok && <Result r={result} />}
    </>
  );
}

export function StatusForm({ propertyId, workOrderId, current }: { propertyId: string; workOrderId: string; current: string | null }) {
  const { pending, result, run } = useAction();
  const [status, setStatus] = useState(current ?? "evidence_pending");
  const [ground, setGround] = useState("");
  const [note, setNote] = useState("");
  return (
    <details>
      <summary className="small">Set compliance status</summary>
      <div className="card stack">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {COMPLIANCE_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        {status === "exempt_recorded" && (
          <input type="text" placeholder="Exemption ground (e.g. owners corporation rules prohibit)" value={ground} onChange={(e) => setGround(e.target.value)} />
        )}
        <input type="text" placeholder="Note (optional; landlord and agency see it)" value={note} onChange={(e) => setNote(e.target.value)} />
        <p className="muted small">You set this from the evidence. The portal never sets it by itself.</p>
        <button disabled={pending} onClick={() => run(() => setUpgradeStatus(propertyId, workOrderId, status, ground, note))}>Save status</button>
        <Result r={result} />
      </div>
    </details>
  );
}

export function SummaryEditor(props: {
  propertyId: string;
  kind: "works" | "completion";
  workOrderId: string | null;
  latest: { id: string; body: string; status: string } | null;
  label: string;
}) {
  const { pending, result, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(props.latest?.body ?? "");
  return (
    <div className="stack">
      {editing ? (
        <>
          <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="Plain English, for the landlord. No prices." />
          <div className="row">
            <button disabled={pending} onClick={() => run(async () => {
              const r = await saveSummary(props.propertyId, props.kind, props.workOrderId, text);
              if (r.ok) setEditing(false);
              return r;
            })}>Save draft</button>
            <button className="secondary" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </>
      ) : (
        <div className="row">
          <button className="secondary" onClick={() => setEditing(true)}>{props.latest ? "Edit" : `Write ${props.label}`}</button>
          {props.latest && props.latest.status === "draft" && (
            <button disabled={pending} onClick={() => run(() => publishSummary(props.propertyId, props.latest!.id))}>Publish</button>
          )}
        </div>
      )}
      <Result r={result} />
    </div>
  );
}

export function NoteForm({ propertyId, workOrderId }: { propertyId: string; workOrderId: string | null }) {
  const { pending, result, run } = useAction();
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState("internal");
  return (
    <details>
      <summary className="small">Add a note</summary>
      <div className="card stack">
        <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="row">
          <select value={visibility} onChange={(e) => setVisibility(e.target.value)}>
            <option value="internal">Internal (HSU only)</option>
            <option value="agency">Agency</option>
            <option value="agency_landlord">Agency and landlord</option>
          </select>
          <button disabled={pending} onClick={() => run(async () => {
            const r = await addNote(propertyId, workOrderId, body, visibility);
            if (r.ok) setBody("");
            return r;
          })}>Add note</button>
        </div>
        <Result r={result} />
      </div>
    </details>
  );
}

export function RemoveNote({ propertyId, noteId }: { propertyId: string; noteId: string }) {
  const { pending, result, run } = useAction();
  return (
    <>
      <button
        className="link"
        disabled={pending}
        onClick={() => {
          const reason = window.prompt("Why remove this note? (It stays in the history.)");
          if (reason) run(() => removeNote(propertyId, noteId, reason));
        }}
      >
        Remove
      </button>
      {result && !result.ok && <Result r={result} />}
    </>
  );
}

export function GenerateReportButton({ propertyId }: { propertyId: string }) {
  const { pending, result, run } = useAction();
  return (
    <div>
      <button disabled={pending} onClick={() => run(() => generateCompletionReport(propertyId))}>
        {pending ? "Building the report…" : "Generate completion report (PDF)"}
      </button>
      <Result r={result} />
    </div>
  );
}
