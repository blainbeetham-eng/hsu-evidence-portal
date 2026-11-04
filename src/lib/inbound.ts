import { createHmac, timingSafeEqual } from "node:crypto";

// Email-in (spec v0.8 item 4). Resend receives mail for the email-in address and calls
// /api/inbound/email. Resend signs webhooks the Svix way: HMAC-SHA256 over
// "<svix-id>.<svix-timestamp>.<raw body>" with the base64 secret after "whsec_".

const TOLERANCE_S = 5 * 60;

export function verifyWebhook(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  body: string,
  nowS = Math.floor(Date.now() / 1000),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowS - ts) > TOLERANCE_S) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  return signature.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const given = Buffer.from(sig, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** "Jo Smith <jo@example.com>" -> { name: "Jo Smith", email: "jo@example.com" } */
export function parseFrom(from: string | null | undefined): { name: string | null; email: string | null } {
  if (!from) return { name: null, email: null };
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || null, email: m[2].trim().toLowerCase() };
  return { name: null, email: from.trim().toLowerCase() };
}

/** Supplier Email in Airtable may hold more than one address. */
export function supplierEmails(field: string | null | undefined): string[] {
  return (field ?? "").split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@"));
}

export const INBOUND_KIND: Record<string, "photo" | "document"> = {
  "application/pdf": "document",
  "image/jpeg": "photo",
  "image/png": "photo",
  "image/heic": "photo",
  "image/heif": "photo",
  "image/webp": "photo",
};
// Images this small are email signature logos and icons (same rule as Make Intake V2).
export const MIN_IMAGE_BYTES = 50 * 1024;
