"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSHA256 } from "hash-wasm";
import { createClient } from "@/lib/supabase/client";
import { quoteValues, totals, visitText, type QField, type QItem, type QKind, type QuoteDef } from "@/lib/quote-visit";
import { addQuoteItem, recordQuotePhoto, removeQuoteItem, removeQuotePhoto, saveQuoteAnswers, saveQuoteItem, type VisitResult } from "../actions";

// Quote visit on the phone. Photos are kept on the phone (IndexedDB) with time and GPS
// until they upload, so a roof space or a dead spot loses nothing. Same pattern as /field.

export type VisitPhoto = { id: string; work_order_id: string; job_item_id: string | null; thumb: string | null };
type Queued = {
  id: string; workOrderId: string; jobItemId: string | null; path: string; blob: Blob; name: string; mime: string;
  capturedAt: string; lat: number | null; lng: number | null; accuracy: number | null; error?: string;
};

const DB = "hsu-visit";
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
function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => { window.removeEventListener("online", cb); window.removeEventListener("offline", cb); };
}

function useResult() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<VisitResult | null>(null);
  const run = (fn: () => Promise<VisitResult>) => start(async () => setResult(await fn()));
  const view = result && <p className={`small ${result.ok ? "muted" : "error"}`}>{result.message}</p>;
  return { pending, run, view };
}

export function VisitJob({ propertyId, workOrderId, def, items, answers, photos }: {
  propertyId: string; workOrderId: string; def: QuoteDef; items: QItem[]; answers: Record<string, string>; photos: VisitPhoto[];
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
      for (const q of (await queueAll()).filter((x) => x.workOrderId === workOrderId)) {
        if (!navigator.onLine) break;
        try {
          const hasher = await createSHA256();
          hasher.update(new Uint8Array(await q.blob.arrayBuffer()));
          const sha256 = hasher.digest("hex");
          const { error } = await supabase.storage.from("evidence").upload(q.path, q.blob, { contentType: q.mime, upsert: false });
          if (error && !/exist|duplicate/i.test(error.message)) throw new Error(error.message);
          const r = await recordQuotePhoto({
            workOrderId, path: q.path, fileName: q.name, mime: q.mime, size: q.blob.size, sha256, capturedAt: q.capturedAt,
            lat: q.lat, lng: q.lng, accuracyM: q.accuracy, jobItemId: q.jobItemId,
          });
          if (!r.ok) throw new Error(r.message);
          await queueDelete(q.id);
        } catch (e) {
          await queuePut({ ...q, error: e instanceof Error ? e.message : "Upload failed" });
          break;
        }
      }
    } finally {
      running.current = false;
      await reload();
      router.refresh();
    }
  }, [workOrderId, reload, router]);

  useEffect(() => {
    const first = setTimeout(() => void process(), 0);
    const up = () => void process();
    window.addEventListener("online", up);
    const timer = setInterval(() => void process(), 30000);
    return () => { clearTimeout(first); window.removeEventListener("online", up); clearInterval(timer); };
  }, [process]);

  async function capture(file: File, jobItemId: string | null) {
    const capturedAt = new Date().toISOString();
    const p = await Promise.race([pos.current ?? position(), new Promise<null>((r) => setTimeout(() => r(null), 8000))]);
    const mime = file.type || "image/jpeg";
    const id = crypto.randomUUID();
    await queuePut({
      id, workOrderId, jobItemId, path: `${workOrderId}/quote-${id}.${EXT[mime] ?? "jpg"}`,
      blob: file, name: file.name || "quote.jpg", mime, capturedAt,
      lat: p?.coords.latitude ?? null, lng: p?.coords.longitude ?? null, accuracy: p?.coords.accuracy ?? null,
    });
    setNote(p ? null : "No location for that photo. Allow location for this site in your phone's settings if you can.");
    await reload();
    void process();
  }

  const photoProps = { queue, photos, propertyId, onStart: () => { pos.current = position(); }, onCapture: capture };
  const sums = totals(def, items, answers);

  return (
    <section className="card stack">
      <h2 style={{ margin: 0 }}>{def.title}</h2>
      {!online && <div className="banner warn small">No signal. Keep going: photos are saved on this phone and upload when you&rsquo;re back online. Measurements need signal to save.</div>}
      {note && <div className="banner warn small">{note}</div>}
      <p className="small muted">{def.intro}</p>

      {sums.length > 0 && (
        <dl className="facts small">
          {sums.map((t) => <span key={t.label} style={{ display: "contents" }}><dt>{t.label}</dt><dd>{t.value}</dd></span>)}
        </dl>
      )}

      <Photos {...photoProps} jobItemId={null} label="General photos" />

      {items.map((i) => {
        const k = def.itemKinds.find((x) => x.kind === i.kind)!;
        return (
          <div key={i.id} className="card stack">
            <div className="row spread"><strong>{i.label}</strong><span className="muted small">{k.label}</span></div>
            <Photos {...photoProps} jobItemId={i.id} label="Photos" />
            <ItemForm workOrderId={workOrderId} item={i} kind={k} />
          </div>
        );
      })}

      {def.itemKinds.length > 0 && <AddItem workOrderId={workOrderId} kinds={def.itemKinds} />}
      {def.jobFields.length > 0 && <JobForm workOrderId={workOrderId} fields={def.jobFields} answers={answers} />}

      {queue.length > 0 && (
        <div className="stack">
          <p className="small">{queue.length} photo{queue.length === 1 ? "" : "s"} waiting to upload{queue.some((q) => q.error) ? ` (last try: ${queue.find((q) => q.error)?.error})` : ""}.</p>
          <button className="secondary" onClick={() => void process()}>Try uploading now</button>
        </div>
      )}
      <CopySummary text={visitText(def, items, answers)} />
    </section>
  );
}

function Photos({ queue, photos, propertyId, jobItemId, label, onStart, onCapture }: {
  queue: Queued[]; photos: VisitPhoto[]; propertyId: string; jobItemId: string | null; label: string;
  onStart: () => void; onCapture: (f: File, jobItemId: string | null) => void;
}) {
  const mine = photos.filter((p) => p.job_item_id === jobItemId);
  const waiting = queue.filter((q) => q.jobItemId === jobItemId);
  return (
    <div className="slot-row">
      <span className="small" style={{ minWidth: 90 }}><strong>{label}</strong></span>
      {mine.map((p) => <Thumb key={p.id} p={p} propertyId={propertyId} />)}
      {waiting.map((q) => <QueuedThumb key={q.id} blob={q.blob} />)}
      <label className="button camera" onClick={onStart}>
        Take photo
        <input type="file" accept="image/*" capture="environment"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onCapture(f, jobItemId); }} />
      </label>
      <label className="button secondary camera">
        From library
        <input type="file" accept="image/*" multiple
          onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ""; for (const f of fs) onCapture(f, jobItemId); }} />
      </label>
    </div>
  );
}

function QueuedThumb({ blob }: { blob: Blob }) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="waiting to upload" style={{ opacity: 0.5 }} />;
}

function Thumb({ p, propertyId }: { p: VisitPhoto; propertyId: string }) {
  const [pending, start] = useTransition();
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {p.thumb ? <img src={p.thumb} alt="" /> : <span className="no-thumb" style={{ width: 64, height: 64 }}>photo</span>}
      <button className="link small" disabled={pending}
        onClick={() => { if (confirm("Remove this photo?")) start(async () => { await removeQuotePhoto(propertyId, p.id); }); }}>remove</button>
    </span>
  );
}

function FieldInput({ f, value, onChange }: { f: QField; value: string; onChange: (v: string) => void }) {
  return (
    <div className="stack" style={{ marginBottom: 0 }}>
      <label className="small">{f.label}{f.type === "number" && f.unit !== "count" ? ` (${f.unit})` : ""}</label>
      {f.type === "yesno" ? (
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option><option value="yes">Yes</option><option value="no">No</option>
        </select>
      ) : f.type === "choice" ? (
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>{f.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : f.type === "number" ? (
        <input type="text" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} />
      )}
      {f.help && <span className="muted small">{f.help}</span>}
    </div>
  );
}

function ItemForm({ workOrderId, item, kind }: { workOrderId: string; item: QItem; kind: QKind }) {
  const [label, setLabel] = useState(item.label);
  const [values, setValues] = useState<Record<string, string>>(quoteValues(item.details));
  const { pending, run, view } = useResult();
  const r = useResult();
  return (
    <details>
      <summary className="small">Measurements{Object.keys(quoteValues(item.details)).length ? "" : " (not entered yet)"}</summary>
      <div className="stack">
        <div className="stack" style={{ marginBottom: 0 }}>
          <label className="small">Name</label>
          <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        {kind.fields.map((f) => <FieldInput key={f.key} f={f} value={values[f.key] ?? ""} onChange={(v) => setValues({ ...values, [f.key]: v })} />)}
        <button disabled={pending} onClick={() => run(() => saveQuoteItem(workOrderId, item.id, values, label))}>Save</button>
        {view}
        <button className="link small" disabled={r.pending}
          onClick={() => { if (confirm(`Remove ${item.label}?`)) r.run(() => removeQuoteItem(workOrderId, item.id)); }}>Remove this item</button>
        {r.view}
      </div>
    </details>
  );
}

function AddItem({ workOrderId, kinds }: { workOrderId: string; kinds: QKind[] }) {
  const [kind, setKind] = useState(kinds[0].kind);
  const [label, setLabel] = useState("");
  const { pending, run, view } = useResult();
  const k = kinds.find((x) => x.kind === kind) ?? kinds[0];
  return (
    <div className="card stack">
      <strong>Add {kinds.length > 1 ? kinds.map((x) => x.label.toLowerCase()).join(", ").replace(/, ([^,]*)$/, " or $1") : `a ${k.label.toLowerCase()}`}</strong>
      {kinds.length > 1 && (
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          {kinds.map((x) => <option key={x.kind} value={x.kind}>{x.label}</option>)}
        </select>
      )}
      <input type="text" placeholder={k.placeholder} value={label} onChange={(e) => setLabel(e.target.value)} />
      <button disabled={pending} onClick={() => run(async () => { const res = await addQuoteItem(workOrderId, kind, label); if (res.ok) setLabel(""); return res; })}>Add</button>
      {view}
    </div>
  );
}

function JobForm({ workOrderId, fields, answers }: { workOrderId: string; fields: QField[]; answers: Record<string, string> }) {
  const [values, setValues] = useState<Record<string, string>>(answers);
  const { pending, run, view } = useResult();
  return (
    <div className="card stack">
      <strong>Whole job</strong>
      {fields.map((f) => <FieldInput key={f.key} f={f} value={values[f.key] ?? ""} onChange={(v) => setValues({ ...values, [f.key]: v })} />)}
      <button disabled={pending} onClick={() => run(() => saveQuoteAnswers(workOrderId, values))}>Save</button>
      {view}
    </div>
  );
}

function CopySummary({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <details>
      <summary className="small">Summary to copy (for Airtable notes, the tender or the quote)</summary>
      <p className="pre small">{text}</p>
      <button className="secondary" onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
        {copied ? "Copied" : "Copy"}
      </button>
    </details>
  );
}
