import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseFrom, supplierEmails, verifyWebhook } from "@/lib/inbound";

const KEY = Buffer.from("test-secret-key-for-webhooks-123");
const SECRET = `whsec_${KEY.toString("base64")}`;
const sign = (id: string, ts: number, body: string, key = KEY) =>
  `v1,${createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64")}`;

describe("email-in webhook signature", () => {
  const body = JSON.stringify({ type: "email.received", data: { email_id: "e1" } });
  const now = 1_800_000_000;

  it("accepts a correctly signed request", () => {
    expect(verifyWebhook(SECRET, { id: "msg_1", timestamp: String(now), signature: sign("msg_1", now, body) }, body, now)).toBe(true);
  });

  it("accepts when one of several signatures matches (secret rotation)", () => {
    const sig = `v1,AAAA ${sign("msg_1", now, body)}`;
    expect(verifyWebhook(SECRET, { id: "msg_1", timestamp: String(now), signature: sig }, body, now)).toBe(true);
  });

  it("rejects a changed body, wrong key, missing headers or an old timestamp", () => {
    const sig = sign("msg_1", now, body);
    expect(verifyWebhook(SECRET, { id: "msg_1", timestamp: String(now), signature: sig }, body + " ", now)).toBe(false);
    expect(verifyWebhook(SECRET, { id: "msg_1", timestamp: String(now), signature: sign("msg_1", now, body, Buffer.from("other")) }, body, now)).toBe(false);
    expect(verifyWebhook(SECRET, { id: null, timestamp: String(now), signature: sig }, body, now)).toBe(false);
    expect(verifyWebhook(SECRET, { id: "msg_1", timestamp: String(now), signature: sig }, body, now + 301)).toBe(false);
    expect(verifyWebhook(SECRET, { id: "msg_2", timestamp: String(now), signature: sig }, body, now)).toBe(false);
  });
});

describe("sender parsing", () => {
  it("reads name and address", () => {
    expect(parseFrom('"Jo Smith" <Jo@Example.com>')).toEqual({ name: "Jo Smith", email: "jo@example.com" });
    expect(parseFrom("jo@example.com")).toEqual({ name: null, email: "jo@example.com" });
  });
  it("splits a supplier email field with several addresses", () => {
    expect(supplierEmails("a@x.com, B@x.com; c@x.com")).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
    expect(supplierEmails(null)).toEqual([]);
  });
});
