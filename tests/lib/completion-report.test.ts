import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { DISCLAIMER, buildCompletionReport, containsPrice } from "@/lib/completion-report";

/** The text drawn on the PDF's pages (pdf-lib writes hex strings into Flate streams). */
function pdfText(pdf: Uint8Array): string[] {
  const raw = Buffer.from(pdf).toString("latin1");
  const out: string[] = [];
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let body: string;
    try { body = inflateSync(Buffer.from(m[1], "latin1")).toString("latin1"); } catch { continue; }
    for (const t of body.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out.push(Buffer.from(t[1], "hex").toString("latin1"));
  }
  return out;
}

const input = {
  address: "31 Grandview Avenue, Glen Iris",
  agency: "Marshall White",
  generatedAt: "4 Nov 2026, 2:00 pm",
  completionSummary: "All three upgrades were completed and the evidence checked.",
  upgrades: Array.from({ length: 3 }, (_, n) => ({
    name: ["Draughtproofing", "Showerheads", "Insulation"][n],
    status: "Evidenced compliant",
    exemptionGround: null,
    statusNote: null,
    worksSummary: "Sealed every external door and window. Rangehood checked “before” sealing.",
    details: ["Front door (External door) - Still opens and closes normally after sealing: yes"],
    photos: Array.from({ length: 5 }, (_, i) => ({ label: `Front door: ${i % 2 ? "After" : "Before"}`, image: null, takenAt: "1 Nov 2026, 10:00 am", provenance: "HSU field team, in-app", location: "location recorded" })),
    documents: ["Product datasheet.pdf"],
  })),
};

describe("completion report PDF", () => {
  it("carries the disclaimer on every page, the address, statuses and provenance", async () => {
    const text = pdfText(await buildCompletionReport(input));
    const pages = text.filter((t) => /^Page \d+ of \d+$/.test(t));
    expect(pages.length).toBeGreaterThanOrEqual(4);
    expect(text.filter((t) => t === DISCLAIMER)).toHaveLength(pages.length);
    expect(text).toContain("31 Grandview Avenue, Glen Iris");
    expect(text.join(" ")).toMatch(/Evidenced compliant/);
    expect(text.join(" ")).toMatch(/HSU field team, in-app/);
  });

  it("contains no price, cost or margin wording", async () => {
    const all = pdfText(await buildCompletionReport(input)).join(" ");
    expect(all).not.toMatch(/\$|price|cost|margin|gst/i);
  });
});

describe("price guard", () => {
  it("spots dollar amounts and GST figures", () => {
    expect(containsPrice("Total $1,250")).toBe(true);
    expect(containsPrice("1250 inc GST")).toBe(true);
    expect(containsPrice("1,250.00 ex. GST")).toBe(true);
    expect(containsPrice("Sealed 12 windows and 3 doors")).toBe(false);
    expect(containsPrice(null)).toBe(false);
  });
});
