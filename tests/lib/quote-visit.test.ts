import { describe, expect, it } from "vitest";
import {
  QUOTE_DEFS, cleanValues, mergeQuoteDetails, mergeWorksDetails, quoteDefFor, quoteValues, sealMetres, totals, visitText,
} from "@/lib/quote-visit";
import { TEMPLATES } from "@/lib/checklists";

const D = QUOTE_DEFS.draughtproofing;

describe("quote definitions", () => {
  it("maps every Airtable activity type", () => {
    for (const t of ["Insulation", "Draughtproofing", "Showerheads", "Heating/Cooling", "Hot Water", "Lighting"]) {
      expect(quoteDefFor(t), t).not.toBeNull();
    }
  });

  it("uses the installer's item kinds and template ids, so items carry into the works stage", () => {
    for (const id of ["draughtproofing", "showerhead"]) {
      const works = TEMPLATES[id].itemKinds.map((k) => k.kind).sort();
      expect(QUOTE_DEFS[id].itemKinds.map((k) => k.kind).sort()).toEqual(works);
    }
  });
});

describe("cleanValues", () => {
  it("keeps known fields, parses numbers, drops bad choices", () => {
    const door = D.itemKinds[0].fields;
    expect(cleanValues(door, { width_mm: "1,020", height_mm: "abc", needs: "Full perimeter", type: "Spaceship", extra: "x", note: " hi " }))
      .toEqual({ width_mm: "1020", needs: "Full perimeter", note: "hi" });
  });
});

describe("details merging", () => {
  it("quote and works values live side by side", () => {
    const afterQuote = mergeQuoteDetails({ operates_normally: "yes" }, { width_mm: "820" });
    expect(afterQuote).toEqual({ operates_normally: "yes", q_width_mm: "820" });
    expect(quoteValues(afterQuote)).toEqual({ width_mm: "820" });
    expect(mergeWorksDetails(afterQuote, {})).toEqual({ q_width_mm: "820" });
    expect(mergeWorksDetails(afterQuote, { operates_normally: "no" })).toEqual({ q_width_mm: "820", operates_normally: "no" });
  });
});

describe("totals", () => {
  const item = (kind: string, label: string, v: Record<string, string>) => ({ id: label, kind, label, details: mergeQuoteDetails({}, v) });

  it("adds up draughtproofing seal length", () => {
    expect(sealMetres("door", { width_mm: "820", height_mm: "2040", needs: "Full perimeter" })).toBeCloseTo(5.72);
    expect(sealMetres("door", { width_mm: "820", needs: "Bottom seal only" })).toBeCloseTo(0.82);
    expect(sealMetres("window", { width_mm: "1000", height_mm: "1000", needs: "Nothing needed" })).toBeNull();
    const t = totals(D, [
      item("door", "Front door", { width_mm: "820", height_mm: "2040", needs: "Full perimeter" }),
      item("window", "Bed 1", { width_mm: "1000", height_mm: "1200", needs: "Full perimeter" }),
      item("window", "Kitchen", { needs: "Full perimeter" }),
      item("vent", "Laundry", { needs: "yes" }),
    ], {});
    expect(t).toEqual([
      { label: "Doors needing sealing", value: "1" },
      { label: "Windows needing sealing", value: "2" },
      { label: "Vents to seal", value: "1" },
      { label: "Seal length", value: "10.1 m" },
      { label: "Still to measure", value: "1 door or window" },
    ]);
  });

  it("works out room area for heating and cooling", () => {
    const t = totals(QUOTE_DEFS.heating_cooling, [item("room", "Living", { length_m: "7.734", width_m: "4.655", height_m: "2.4" })], {});
    expect(t).toEqual([{ label: "Living area", value: "36 m² (86.4 m³)" }]);
  });

  it("writes a plain summary to copy", () => {
    const text = visitText(D, [item("door", "Front door", { width_mm: "820", height_mm: "2040", needs: "Full perimeter", type: "Hinged" })], { flueless_heater: "no" });
    expect(text).toContain("- Front door (external door): 820 x 2040 mm; door type Hinged; sealing needed Full perimeter");
    expect(text).toContain("Flueless or open-flued gas heater?: No");
  });
});
