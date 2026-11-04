import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

// Completion report PDF (spec 3C). Built only from published summaries, compliance
// statuses Blain set, and accepted evidence. Never contains a price, cost or margin;
// every page carries the disclaimer.

export const DISCLAIMER = "Evidence record only. Not a certificate of compliance.";

export type ReportPhoto = {
  label: string;
  image: { bytes: Uint8Array; type: "jpg" | "png" } | null; // null: not embeddable (e.g. HEIC)
  takenAt: string | null;
  provenance: string; // who captured it and how
  location: string; // "location recorded" | "no location"
};
export type ReportUpgrade = {
  name: string;
  status: string;
  exemptionGround: string | null;
  statusNote: string | null;
  worksSummary: string | null;
  details: string[];
  photos: ReportPhoto[];
  documents: string[];
};
export type ReportInput = {
  address: string;
  agency: string | null;
  generatedAt: string; // already formatted, Melbourne time
  completionSummary: string | null;
  upgrades: ReportUpgrade[];
};

/** Dollar amounts or GST figures: a summary with these can't go into the report. */
export function containsPrice(text: string | null | undefined): boolean {
  return !!text && /\$\s?\d|\b\d[\d,]*(\.\d{1,2})?\s*(inc|ex|incl|excl)\.?\s*gst\b/i.test(text);
}

const GREEN = rgb(0x1b / 255, 0x5e / 255, 0x20 / 255);
const GREY = rgb(0.4, 0.4, 0.4);
const A4: [number, number] = [595.28, 841.89];
const M = 50;

// Standard PDF fonts only cover Latin-1; swap the usual typographic characters.
function clean(s: string): string {
  return s
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...")
    .replace(/[^\n\x20-\x7E\xA0-\xFF]/g, "");
}

export async function buildCompletionReport(input: ReportInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Completion report - ${clean(input.address)}`);
  doc.setProducer("HomeStar Evidence Portal");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const width = A4[0] - 2 * M;

  let page: PDFPage = doc.addPage(A4);
  let y = A4[1] - M;
  const newPage = () => { page = doc.addPage(A4); y = A4[1] - M; };
  const need = (h: number) => { if (y - h < M + 30) newPage(); };

  const wrap = (text: string, f: PDFFont, size: number): string[] => {
    const lines: string[] = [];
    for (const para of clean(text).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (f.widthOfTextAtSize(next, size) > width && line) { lines.push(line); line = word; } else line = next;
      }
      lines.push(line);
    }
    return lines;
  };
  const text = (t: string, opts: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb>; gap?: number } = {}) => {
    const size = opts.size ?? 10;
    for (const line of wrap(t, opts.f ?? font, size)) {
      need(size + 4);
      page.drawText(line, { x: M, y: y - size, size, font: opts.f ?? font, color: opts.color ?? rgb(0, 0, 0) });
      y -= size + 4;
    }
    y -= opts.gap ?? 4;
  };

  text("HomeStar Upgrades", { size: 11, f: bold, color: GREEN, gap: 0 });
  text("Completion report", { size: 20, f: bold, color: GREEN });
  text(input.address, { size: 13, f: bold });
  if (input.agency) text(`Agency: ${input.agency}`);
  text(`Generated ${input.generatedAt}`, { color: GREY, gap: 12 });

  text("Summary", { size: 13, f: bold, color: GREEN });
  text(input.completionSummary ?? "No completion summary published.", { gap: 12 });

  text("Upgrades", { size: 13, f: bold, color: GREEN });
  for (const u of input.upgrades) {
    text(`${u.name}: ${u.status}`, { f: bold });
    if (u.exemptionGround) text(`Exemption ground: ${u.exemptionGround}`);
    if (u.statusNote) text(u.statusNote, { color: GREY });
  }
  y -= 8;

  const PHOTO_W = (width - 12) / 2;
  const PHOTO_H = PHOTO_W * 0.75;
  for (const u of input.upgrades) {
    newPage();
    text(u.name, { size: 15, f: bold, color: GREEN });
    text(`Compliance status: ${u.status}${u.exemptionGround ? ` (${u.exemptionGround})` : ""}`, { f: bold });
    if (u.worksSummary) text(u.worksSummary, { gap: 8 });
    for (const d of u.details) text(d, { size: 9 });
    if (u.documents.length) {
      text("Documents", { f: bold });
      for (const d of u.documents) text(`- ${d}`, { size: 9 });
    }
    if (!u.photos.length) { text("No photos accepted for this upgrade.", { color: GREY }); continue; }
    text("Photos", { f: bold });
    for (let i = 0; i < u.photos.length; i += 2) {
      const row = u.photos.slice(i, i + 2);
      need(PHOTO_H + 46);
      const top = y;
      for (const [n, p] of row.entries()) {
        const x = M + n * (PHOTO_W + 12);
        if (p.image) {
          const img = p.image.type === "png" ? await doc.embedPng(p.image.bytes) : await doc.embedJpg(p.image.bytes);
          const s = Math.min(PHOTO_W / img.width, PHOTO_H / img.height);
          page.drawImage(img, { x, y: top - PHOTO_H + (PHOTO_H - img.height * s), width: img.width * s, height: img.height * s });
        } else {
          page.drawRectangle({ x, y: top - PHOTO_H, width: PHOTO_W, height: PHOTO_H, borderColor: GREY, borderWidth: 0.5 });
          page.drawText("Photo kept in the portal (format can't be shown here)", { x: x + 6, y: top - PHOTO_H / 2, size: 8, font, color: GREY });
        }
        const caption = [clean(p.label), clean(`${p.takenAt ?? "time not recorded"} · ${p.provenance} · ${p.location}`)];
        caption.forEach((c, k) => page.drawText(c.slice(0, 70), { x, y: top - PHOTO_H - 11 - k * 10, size: k ? 7 : 8, font: k ? font : bold, color: k ? GREY : rgb(0, 0, 0) }));
      }
      y = top - PHOTO_H - 36;
    }
  }

  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawText(DISCLAIMER, { x: M, y: 28, size: 8, font: bold, color: GREY });
    p.drawText(`Page ${i + 1} of ${pages.length}`, { x: A4[0] - M - 60, y: 28, size: 8, font, color: GREY });
  });
  return doc.save();
}
