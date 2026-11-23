"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSHA256 } from "hash-wasm";
import { createClient } from "@/lib/supabase/client";
import type { Field, Slot, Template } from "@/lib/checklists";
import { addItem, discardPhoto, recordCapture, removeItem, saveAnswers, saveItemDetails, submitJob, type FieldResult } from "../actions";

// Phone capture for HSU's field team (spec Section 5). Each photo is saved on the phone
// first (IndexedDB) with the time and GPS position taken at the moment of capture, then
// uploaded when there's signal. Nothing is lost if the roof space has no reception.

export type ServerPhoto = {
  id: string; storage_path: string; job_item_id: string | null; checklist_key: string | null;
  review_status: string; review_note: string | null; mime: string | null; flags: string[]; thumb: string | null;
};
type Item = { id: string; kind: string; label: string; details: Record<string, string> };
type Queued = {
  id: string; workOrderId: string; jobItemId: string | null; slotKey: string; path: string;
  blob: Blob; name: string; mime: string; capturedAt: string;
  lat: number | null; lng: number | null; accuracy: number | null; error?: string;
};

// ---------------------------------------------------------------------------
// Tiny IndexedDB queue
// ---------------------------------------------------------------------------
const DB = "hsu-field";
const STORE = "captures";
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(req.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
const queueAll = () => idb<Queued[]>("readonly", (s) => s.getAll() as IDBRequest<Queued[]>);
const queuePut = (q: Queued) => idb("readwrite", (s) => s.put(q));
const queueDelete = (id: string) => idb("readwrite", (s) => s.delete(id));

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/heic": "heic", "image/heif": "heif", "image/webp": "webp" };

function position(): Promise<GeolocationPosition | null> {
  if (!("geolocation" in navigator)) return Promise.resolve(null);
  return new Promise((resolve) =>
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }),
  );
}

export function FieldJob({ workOrderId, template, items, answers, photos }: {
  workOrderId: string; template: Template; items: Item[]; answers: Record<string, string>; photos: ServerPhoto[];
}) {
  const router = useRouter();
  const [queue, setQueue] = useState<Queued[]>([]);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [note, setNote] = useState<string | null>(null);
  const running = useRef(false);
  const pos = useRef<Promise<GeolocationPosition | null> | null>(null);

  const reload = useCallback(async () => {
    const all = await queueAll().catch(() => [] as Queued[]);
    setQueue(all.filter((q) => q.workOrderId === workOrderId));
  }, [workOrderId]);

  const process = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      const supabase = createClient();
      let unreadable = 0;
      for (const q of (await queueAll()).filter((x) => x.workOrderId === workOrderId)) {
        if (!navigator.onLine) break;
        // A photo whose contents the phone can no longer read: drop it and ask for it again.
        const bytes = await readBytes(q.blob);
        if (!bytes) { await queueDelete(q.id); unreadable++; continue; }
        try {
          const hasher = await createSHA256();
          hasher.update(new Uint8Array(bytes));
          const sha256 = hasher.digest("hex");
          // Send the bytes themselves (not the Blob), so the upload can't go out empty.
          const { error } = await supabase.storage.from("evidence").upload(q.path, bytes, { contentType: q.mime, upsert: false });
          // "already exists" means an earlier try uploaded it but didn't finish recording.
          if (error && !/exist|duplicate/i.test(error.message)) throw new Error(error.message);
          const r = await recordCapture({
            workOrderId, path: q.path, fileName: q.name, mime: q.mime, size: bytes.byteLength, sha256, capturedAt: q.capturedAt,
            lat: q.lat, lng: q.lng, accuracyM: q.accuracy, jobItemId: q.jobItemId, slotKey: q.slotKey,
          });
          if (!r.ok) throw new Error(r.message);
          await queueDelete(q.id);
        } catch (e) {
          await queuePut({ ...q, error: e instanceof Error ? e.message : "Upload failed" });
          break; // try again later (back online, or in 30 seconds)
        }
      }
      if (unreadable) setNote(`${unreadable} photo${unreadable === 1 ? "" : "s"} couldn't be read back from this phone and ${unreadable === 1 ? "was" : "were"} removed. Please take ${unreadable === 1 ? "it" : "them"} again.`);
    } finally {
      running.current = false;
      await reload();
      router.refresh();
    }
  }, [workOrderId, reload, router]);

  useEffect(() => {
    const first = setTimeout(() => void process(), 0); // process() reloads the queue when done
    const up = () => void process();
    window.addEventListener("online", up);
    const timer = setInterval(() => void process(), 30000);
    return () => { clearTimeout(first); window.removeEventListener("online", up); clearInterval(timer); };
  }, [reload, process]);

  async function capture(file: File, jobItemId: string | null, slot: Slot) {
    const capturedAt = new Date().toISOString();
    const p = await Promise.race([pos.current ?? position(), new Promise<null>((r) => setTimeout(() => r(null), 8000))]);
    const mime = file.type || "image/jpeg";
    // Copy the bytes now: on iPhone the picked File reads back empty once stored for later.
    const bytes = await readBytes(file);
    if (!bytes) { setNote("That photo couldn't be read. Try taking it again."); return; }
    const id = crypto.randomUUID();
    await queuePut({
      id, workOrderId, jobItemId, slotKey: slot.key, path: `${workOrderId}/${id}.${EXT[mime] ?? "jpg"}`,
      blob: new Blob([bytes], { type: mime }), name: file.name || `${slot.key}.jpg`, mime, capturedAt,
      lat: p?.coords.latitude ?? null, lng: p?.coords.longitude ?? null, accuracy: p?.coords.accuracy ?? null,
    });
    setNote(p ? null : "No location for that photo. Allow location for this site in your phone's settings if you can.");
    await reload();
    void process();
  }

  const slotProps = { queue, photos, workOrderId, onStart: () => { pos.current = position(); }, onCapture: capture };
  const drafts = photos.filter((p) => p.review_status === "draft").length;
  const needsMore = photos.filter((p) => p.review_status === "needs_more");

  return (
    <div className="stack">
      {!online && <div className="banner warn small">No signal. Keep taking photos: they&rsquo;re saved on this phone and upload when you&rsquo;re back online.</div>}
      {note && <div className="banner warn small">{note}</div>}
      {needsMore.length > 0 && (
        <div className="banner warn small">
          <strong>HSU asked for more:</strong>
          <ul>{[...new Set(needsMore.map((p) => p.review_note))].map((n) => <li key={n}>{n}</li>)}</ul>
          Take the extra photos, then press Send again.
        </div>
      )}

      <p className="small">{template.intro}</p>

      {template.jobSlots.map((s) => (
        <div key={s.key} className="card"><SlotRow {...slotProps} jobItemId={null} slot={s} /></div>
      ))}

      {items.map((i) => {
        const k = template.itemKinds.find((x) => x.kind === i.kind);
        return (
          <div key={i.id} className="card stack">
            <div className="row spread">
              <strong>{i.label}</strong>
              <span className="muted small">{k?.label}</span>
            </div>
            {(k?.slots ?? []).map((s) => <SlotRow key={s.key} {...slotProps} jobItemId={i.id} slot={s} />)}
            {k && k.fields.length > 0 && <ItemFields workOrderId={workOrderId} item={i} fields={k.fields} />}
            <RemoveItem workOrderId={workOrderId} itemId={i.id} />
          </div>
        );
      })}

      <AddItem workOrderId={workOrderId} template={template} />
      {template.questions.length > 0 && <Questions workOrderId={workOrderId} fields={template.questions} answers={answers} />}

      <div className="queue-bar stack">
        <p className="small">
          {queue.length > 0
            ? `${queue.length} photo${queue.length === 1 ? "" : "s"} waiting to upload${queue.some((q) => q.error) ? ` (last try: ${queue.find((q) => q.error)?.error})` : ""}.`
            : drafts > 0 ? `${drafts} photo${drafts === 1 ? "" : "s"} ready to send.` : "Nothing new to send."}
        </p>
        {queue.length > 0 && <button className="secondary" onClick={() => void process()}>Try uploading now</button>}
        <SubmitButton workOrderId={workOrderId} disabled={queue.length > 0 || drafts === 0} />
      </div>
    </div>
  );
}

function SlotRow({ slot, jobItemId, queue, photos, workOrderId, onStart, onCapture }: {
  slot: Slot; jobItemId: string | null; queue: Queued[]; photos: ServerPhoto[]; workOrderId: string;
  onStart: () => void; onCapture: (f: File, jobItemId: string | null, slot: Slot) => Promise<void>;
}) {
  const mine = photos.filter((p) => p.job_item_id === jobItemId && p.checklist_key === slot.key);
  const waiting = queue.filter((q) => q.jobItemId === jobItemId && q.slotKey === slot.key);

  return (
    <div className="stack">
      <div className="slot-row">
        <span className="small" style={{ minWidth: 90 }}><strong>{slot.label}</strong></span>
        {mine.map((p) => <ThumbWithStatus key={p.id} p={p} workOrderId={workOrderId} />)}
        {waiting.map((q) => <QueuedThumb key={q.id} blob={q.blob} />)}
        <label className="button camera" onClick={onStart}>
          Take photo
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void onCapture(f, jobItemId, slot); }}
          />
        </label>
      </div>
    </div>
  );
}

/** The bytes of a photo, or null if the phone can't read it (or it's empty). */
async function readBytes(b: Blob): Promise<ArrayBuffer | null> {
  try {
    const buf = await b.arrayBuffer();
    return buf.byteLength > 0 ? buf : null;
  } catch {
    return null;
  }
}

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => { window.removeEventListener("online", cb); window.removeEventListener("offline", cb); };
}

/** A photo still on the phone, waiting to upload. */
function QueuedThumb({ blob }: { blob: Blob }) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="waiting to upload" style={{ opacity: 0.5 }} />;
}

const STATUS: Record<string, string> = { draft: "not sent", pending: "sent", accepted: "accepted", needs_more: "more needed", rejected: "rejected" };

function ThumbWithStatus({ p, workOrderId }: { p: ServerPhoto; workOrderId: string }) {
  const [pending, start] = useTransition();
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {p.thumb ? <img src={p.thumb} alt="" /> : <span className="no-thumb" style={{ width: 64, height: 64 }}>photo</span>}
      <span className={`tag ${p.review_status === "rejected" ? "bad" : p.review_status === "draft" || p.review_status === "needs_more" ? "warn" : ""}`}>{STATUS[p.review_status]}</span>
      {p.review_status === "draft" && (
        <button className="link small" disabled={pending} onClick={() => { if (confirm("Remove this photo?")) start(async () => { await discardPhoto(workOrderId, p.id); }); }}>remove</button>
      )}
    </span>
  );
}

function useResult() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<FieldResult | null>(null);
  const run = (fn: () => Promise<FieldResult>) => start(async () => setResult(await fn()));
  const view = result && <p className={`small ${result.ok ? "muted" : "error"}`}>{result.message}</p>;
  return { pending, run, view };
}

function FieldInput({ f, value, onChange }: { f: Field; value: string; onChange: (v: string) => void }) {
  return (
    <div className="stack" style={{ marginBottom: 0 }}>
      <label className="small">{f.label}</label>
      {f.type === "yesno" ? (
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option><option value="yes">Yes</option><option value="no">No</option>
        </select>
      ) : f.type === "choice" ? (
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>{f.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} />
      )}
      {f.help && <span className="muted small">{f.help}</span>}
    </div>
  );
}

function ItemFields({ workOrderId, item, fields }: { workOrderId: string; item: Item; fields: Field[] }) {
  const [values, setValues] = useState<Record<string, string>>(item.details ?? {});
  const { pending, run, view } = useResult();
  return (
    <div className="stack">
      {fields.map((f) => <FieldInput key={f.key} f={f} value={values[f.key] ?? ""} onChange={(v) => setValues({ ...values, [f.key]: v })} />)}
      <button className="secondary" disabled={pending} onClick={() => run(() => saveItemDetails(workOrderId, item.id, values))}>Save details</button>
      {view}
    </div>
  );
}

function RemoveItem({ workOrderId, itemId }: { workOrderId: string; itemId: string }) {
  const { pending, run, view } = useResult();
  return (
    <>
      <button className="link small" disabled={pending} onClick={() => { if (confirm("Remove this from the job?")) run(() => removeItem(workOrderId, itemId)); }}>
        Remove this item
      </button>
      {view}
    </>
  );
}

function AddItem({ workOrderId, template }: { workOrderId: string; template: Template }) {
  const [kind, setKind] = useState(template.itemKinds[0]?.kind ?? "");
  const [label, setLabel] = useState("");
  const { pending, run, view } = useResult();
  return (
    <div className="card stack">
      <strong>Add {template.itemKinds.length > 1 ? "a door, window or vent" : `a ${template.itemKinds[0]?.label.toLowerCase()}`}</strong>
      {template.itemKinds.length > 1 && (
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          {template.itemKinds.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
        </select>
      )}
      <input type="text" placeholder={template.id === "showerhead" ? "Which bathroom, e.g. Main bathroom" : "Where, e.g. Front door, Bedroom 1 window"} value={label} onChange={(e) => setLabel(e.target.value)} />
      <button disabled={pending} onClick={() => run(async () => { const r = await addItem(workOrderId, kind, label); if (r.ok) setLabel(""); return r; })}>Add</button>
      {view}
    </div>
  );
}

function Questions({ workOrderId, fields, answers }: { workOrderId: string; fields: Field[]; answers: Record<string, string> }) {
  const [values, setValues] = useState<Record<string, string>>(answers);
  const { pending, run, view } = useResult();
  return (
    <div className="card stack">
      <strong>Questions about the home</strong>
      {fields.map((f) => <FieldInput key={f.key} f={f} value={values[f.key] ?? ""} onChange={(v) => setValues({ ...values, [f.key]: v })} />)}
      <button className="secondary" disabled={pending} onClick={() => run(() => saveAnswers(workOrderId, values))}>Save answers</button>
      {view}
    </div>
  );
}

function SubmitButton({ workOrderId, disabled }: { workOrderId: string; disabled: boolean }) {
  const { pending, run, view } = useResult();
  return (
    <>
      <button disabled={disabled || pending} onClick={() => run(() => submitJob(workOrderId))}>
        {pending ? "Sending…" : "Send to HSU for review"}
      </button>
      {view}
    </>
  );
}
