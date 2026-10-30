import "server-only";
import { createSign } from "node:crypto";
import { serverEnv } from "@/lib/env";

// Read-only Google Drive access with a service account (spec v0.7, Section 3D).
// The "Jobs" folder is shared with the service account as Viewer; the private
// consent-evidence folder is not, so the portal can never read original emails.

const SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const API = "https://www.googleapis.com/drive/v3";

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  imageMediaMetadata?: { time?: string };
};

/** Folder ID from a Drive folder link ("/folders/<id>" or "?id=<id>"). */
export function driveFolderId(url: string): string | null {
  const m = url.match(/\/folders\/([A-Za-z0-9_-]{10,})/) ?? url.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  return m?.[1] ?? null;
}

async function accessToken(): Promise<string> {
  const key = JSON.parse(serverEnv.googleServiceAccountJson()) as { client_email: string; private_key: string };
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: key.client_email,
    scope: SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 600,
  })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(key.private_key, "base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`Google sign-in failed (${res.status})`);
  return ((await res.json()) as { access_token: string }).access_token;
}

export async function driveClient() {
  const token = await accessToken();
  const get = (path: string) => fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });

  return {
    /** Files directly in the folder (not subfolders), excluding trashed ones. */
    async list(folderId: string): Promise<DriveFile[]> {
      const files: DriveFile[] = [];
      let pageToken = "";
      do {
        const q = new URLSearchParams({
          q: `'${folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
          fields: "nextPageToken, files(id, name, mimeType, size, imageMediaMetadata/time)",
          pageSize: "1000",
          supportsAllDrives: "true",
          includeItemsFromAllDrives: "true",
          ...(pageToken ? { pageToken } : {}),
        });
        const res = await get(`/files?${q}`);
        if (res.status === 404) throw new Error("Drive folder not found, or not shared with the portal's service account.");
        if (!res.ok) throw new Error(`Drive list failed (${res.status})`);
        const body = (await res.json()) as { files: DriveFile[]; nextPageToken?: string };
        files.push(...body.files);
        pageToken = body.nextPageToken ?? "";
      } while (pageToken);
      return files;
    },

    async download(fileId: string): Promise<Buffer> {
      const res = await get(`/files/${fileId}?alt=media&supportsAllDrives=true`);
      if (!res.ok) throw new Error(`Drive download failed (${res.status})`);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

/** Drive's EXIF time ("2026:10:21 10:15:00", camera-local) as ISO, read as Melbourne time. */
export function driveTakenAt(f: DriveFile): string | null {
  const m = f.imageMediaMetadata?.time?.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const local = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  const offset = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", timeZoneName: "longOffset" })
    .formatToParts(new Date(`${local}Z`))
    .find((p) => p.type === "timeZoneName")?.value.replace("GMT", "");
  return `${local}${offset || "+10:00"}`;
}
