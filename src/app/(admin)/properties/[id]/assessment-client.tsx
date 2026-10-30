"use client";
import { useState, useTransition } from "react";
import * as tus from "tus-js-client";
import { createSHA256 } from "hash-wasm";
import exifr from "exifr";
import { createClient } from "@/lib/supabase/client";
import { publicEnv } from "@/lib/env";
import {
  approveSummary,
  editSummary,
  hideSummary,
  importFromDrive,
  recordUpload,
  regenerateSummary,
  setFileHidden,
  type ActionResult,
} from "./actions";

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

export function ImportButton({ propertyId, workOrderId, label }: { propertyId: string; workOrderId: string; label: string }) {
  const { pending, result, run } = useAction();
  return (
    <div>
      <button className="secondary" disabled={pending} onClick={() => run(() => importFromDrive(propertyId, workOrderId))}>
        {pending ? "Importing… (a report summary can take a minute)" : label}
      </button>
      <Result r={result} />
    </div>
  );
}

export function SummaryActions(props: { propertyId: string; summaryId: string; reportId: string; status: string; body: string }) {
  const { pending, result, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(props.body);
  return (
    <div>
      {editing ? (
        <div className="stack">
          <textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row">
            <button disabled={pending} onClick={() => run(async () => { const r = await editSummary(props.propertyId, props.summaryId, text); if (r.ok) setEditing(false); return r; })}>Save as new draft</button>
            <button className="secondary" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="row">
          {props.status !== "approved" && (
            <button disabled={pending} onClick={() => run(() => approveSummary(props.propertyId, props.summaryId))}>Approve</button>
          )}
          <button className="secondary" disabled={pending} onClick={() => run(() => regenerateSummary(props.propertyId, props.reportId))}>
            {pending ? "Working…" : "Regenerate"}
          </button>
          <button className="secondary" disabled={pending} onClick={() => setEditing(true)}>Edit</button>
          {props.status !== "hidden" && (
            <button className="secondary" disabled={pending} onClick={() => run(() => hideSummary(props.propertyId, props.summaryId))}>Hide</button>
          )}
        </div>
      )}
      <Result r={result} />
    </div>
  );
}

export function GenerateSummaryButton({ propertyId, reportId }: { propertyId: string; reportId: string }) {
  const { pending, result, run } = useAction();
  return (
    <div>
      <button className="secondary" disabled={pending} onClick={() => run(() => regenerateSummary(propertyId, reportId))}>
        {pending ? "Summarising… (up to a minute)" : "Generate AI summary"}
      </button>
      <Result r={result} />
    </div>
  );
}

export function HideToggle({ propertyId, fileId, hidden }: { propertyId: string; fileId: string; hidden: boolean }) {
  const { pending, result, run } = useAction();
  return (
    <>
      <button className="link" disabled={pending} onClick={() => run(() => setFileHidden(propertyId, fileId, !hidden))}>
        {hidden ? "Show" : "Hide"}
      </button>
      {result && !result.ok && <Result r={result} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Upload: straight from the browser to Supabase Storage, resumable (survives a
// dropped connection), so big DI videos skip Vercel's size and time limits.
// ---------------------------------------------------------------------------

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", heic: "image/heic",
  heif: "image/heif", webp: "image/webp", mp4: "video/mp4", mov: "video/quicktime",
};
const CHUNK = 6 * 1024 * 1024; // Supabase's resumable uploads require 6 MB chunks

function mimeOf(file: File) {
  return file.type || MIME_BY_EXT[file.name.split(".").pop()?.toLowerCase() ?? ""] || "";
}

async function hashFile(file: File, onProgress: (p: number) => void) {
  const hasher = await createSHA256();
  for (let offset = 0; offset < file.size; offset += CHUNK) {
    hasher.update(new Uint8Array(await file.slice(offset, offset + CHUNK).arrayBuffer()));
    onProgress(Math.min(1, (offset + CHUNK) / file.size));
  }
  return hasher.digest("hex");
}

/** A still image (about 1 second in) and the length of a video, read in the browser. */
function videoPoster(file: File): Promise<{ poster: Blob | null; duration: number | null }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    const done = (poster: Blob | null, duration: number | null) => { URL.revokeObjectURL(url); resolve({ poster, duration }); };
    video.preload = "metadata";
    video.muted = true;
    video.src = url;
    video.onerror = () => done(null, null);
    video.onloadedmetadata = () => { video.currentTime = Math.min(1, video.duration / 2 || 0); };
    video.onseeked = () => {
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 960 / (video.videoWidth || 960));
      canvas.width = Math.round((video.videoWidth || 960) * scale);
      canvas.height = Math.round((video.videoHeight || 540) * scale);
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => done(b, Number.isFinite(video.duration) ? video.duration : null), "image/jpeg", 0.8);
    };
  });
}

function tusUpload(file: File | Blob, path: string, contentType: string, token: string, onProgress: (p: number) => void) {
  const endpoint = `${publicEnv.supabaseUrl.replace(".supabase.co", ".storage.supabase.co")}/storage/v1/upload/resumable`;
  return new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: { authorization: `Bearer ${token}`, "x-upsert": "false" },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: CHUNK,
      metadata: { bucketName: "evidence", objectName: path, contentType, cacheControl: "3600" },
      onProgress: (sent, total) => onProgress(total ? sent / total : 0),
      onSuccess: () => resolve(),
      onError: (e) => reject(e),
    });
    upload.findPreviousUploads().then((previous) => {
      if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    });
  });
}

const safeName = (name: string) => name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120);

export function UploadPanel({ propertyId, workOrders }: { propertyId: string; workOrders: { id: string; label: string }[] }) {
  const [workOrderId, setWorkOrderId] = useState(workOrders[0]?.id ?? "");
  const [status, setStatus] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function upload(files: FileList) {
    setBusy(true);
    const log = (i: number, line: string) => setStatus((s) => { const n = [...s]; n[i] = line; return n; });
    setStatus(Array.from(files, (f) => `${f.name}: waiting`));
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) { setStatus(["Your session has expired. Reload the page and sign in again."]); setBusy(false); return; }

    for (const [i, file] of Array.from(files).entries()) {
      const mime = mimeOf(file);
      if (!MIME_BY_EXT[file.name.split(".").pop()?.toLowerCase() ?? ""] && !Object.values(MIME_BY_EXT).includes(mime)) {
        log(i, `${file.name}: not a PDF, photo or MP4/MOV video, skipped`);
        continue;
      }
      try {
        const sha256 = await hashFile(file, (p) => log(i, `${file.name}: checking ${Math.round(p * 100)}%`));
        let takenAt: string | null = null;
        if (mime.startsWith("image/")) {
          const exif = await exifr.parse(file, ["DateTimeOriginal"]).catch(() => null);
          if (exif?.DateTimeOriginal instanceof Date) takenAt = exif.DateTimeOriginal.toISOString();
        }
        const base = `${workOrderId}/${crypto.randomUUID()}`;
        const path = `${base}-${safeName(file.name)}`;
        let posterPath: string | null = null;
        let durationS: number | null = null;
        if (mime.startsWith("video/")) {
          const { poster, duration } = await videoPoster(file);
          durationS = duration;
          if (poster) {
            posterPath = `${base}-poster.jpg`;
            await tusUpload(poster, posterPath, "image/jpeg", token, () => {});
          }
        }
        await tusUpload(file, path, mime, token, (p) => log(i, `${file.name}: uploading ${Math.round(p * 100)}%`));
        log(i, `${file.name}: saving`);
        const r = await recordUpload({
          propertyId, workOrderId, path, posterPath, fileName: file.name, mime, size: file.size, sha256, takenAt, durationS,
        });
        log(i, `${file.name}: ${r.message}`);
      } catch (e) {
        log(i, `${file.name}: failed (${e instanceof Error ? e.message : "upload error"}). Try again; it resumes where it stopped.`);
      }
    }
    setBusy(false);
  }

  if (!workOrders.length) return <p className="muted small">No work orders to attach files to.</p>;
  return (
    <div className="card stack">
      <div className="row">
        <label htmlFor="wo">Attach to</label>
        <select id="wo" value={workOrderId} onChange={(e) => setWorkOrderId(e.target.value)} disabled={busy}>
          {workOrders.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
        </select>
      </div>
      <input
        type="file"
        multiple
        disabled={busy}
        accept="application/pdf,image/jpeg,image/png,image/heic,image/heif,image/webp,video/mp4,video/quicktime,.heic,.mov"
        onChange={(e) => { if (e.target.files?.length) void upload(e.target.files); e.target.value = ""; }}
      />
      <p className="muted small">
        Reports (PDF), photos and the DI video (MP4 or MOV, up to 2 GB). Keep this page open until each file says
        &ldquo;Uploaded&rdquo;.
      </p>
      {status.map((s, i) => <p key={i} className="small">{s}</p>)}
    </div>
  );
}
