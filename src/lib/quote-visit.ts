// Quote visit (site measure before quoting), admin only. Blain's request of 23 Nov 2026:
// one place on the phone for photos and measurements at a quote visit.
//
// Measurements for doors, windows, vents and showers are stored on the same job_items the
// installer uses later (details keys starting "q_"), so the works stage starts from the
// rooms already measured. Job-level answers live in quote_visits. Photos are evidence_files
// at stage "assessment", checklist_key "quote", hidden from landlords until Blain shows them.
// Templates are data: change wording here and bump the version.

export type QField =
  | { key: string; label: string; type: "number"; unit: string; help?: string }
  | { key: string; label: string; type: "text"; help?: string }
  | { key: string; label: string; type: "yesno"; help?: string }
  | { key: string; label: string; type: "choice"; options: string[]; help?: string };

export type QKind = { kind: string; label: string; placeholder: string; fields: QField[] };

export type QuoteDef = {
  id: string; // also the job_items.template value (matches the works template where one exists)
  version: string;
  title: string;
  intro: string;
  itemKinds: QKind[];
  jobFields: QField[];
};

export type QItem = { id: string; kind: string; label: string; details: Record<string, string> };
export type Total = { label: string; value: string };

export const QUOTE_PHOTO_KEY = "quote";
export const PREFIX = "q_";

const NOTE: QField = { key: "note", label: "Notes", type: "text" };

const QTY: QField = {
  key: "qty", label: "How many like this", type: "number", unit: "count",
  help: "e.g. 2 for a pair of French doors (measure one leaf) or two matching windows. Blank means 1.",
};

const DRAUGHT_NEEDS =["Full perimeter", "Bottom seal only", "Part of frame", "Nothing needed"];

export const QUOTE_DEFS: Record<string, QuoteDef> = {
  draughtproofing: {
    id: "draughtproofing",
    version: "2026-11-23",
    title: "Draughtproofing",
    intro: "Add each external door and window and any unsealed vent. Measure the opening (inside of the frame) in millimetres.",
    itemKinds: [
      {
        kind: "door", label: "External door", placeholder: "e.g. Front door",
        fields: [
          { key: "type", label: "Door type", type: "choice", options: ["Hinged", "French (pair)", "Sliding", "Bi-fold", "Other"] },
          { key: "width_mm", label: "Width", type: "number", unit: "mm" },
          { key: "height_mm", label: "Height", type: "number", unit: "mm" },
          QTY,
          { key: "needs", label: "Sealing needed", type: "choice", options: DRAUGHT_NEEDS },
          NOTE,
        ],
      },
      {
        kind: "window", label: "External window", placeholder: "e.g. Bedroom 1 window",
        fields: [
          { key: "type", label: "Window type", type: "choice", options: ["Double-hung sash", "Awning", "Casement", "Sliding", "Louvre", "Fixed", "Other"] },
          { key: "width_mm", label: "Width", type: "number", unit: "mm" },
          { key: "height_mm", label: "Height", type: "number", unit: "mm" },
          QTY,
          { key: "needs", label: "Sealing needed", type: "choice", options: DRAUGHT_NEEDS },
          NOTE,
        ],
      },
      {
        kind: "vent", label: "Wall vent", placeholder: "e.g. Laundry wall vent",
        fields: [
          { key: "size", label: "Size", type: "text", help: "e.g. 225 x 150 mm" },
          { key: "gas_nearby", label: "Gas appliance in this room?", type: "yesno",
            help: "Vents serving gas appliances must stay open. Take a photo of the appliance." },
          { key: "needs", label: "Needs sealing?", type: "yesno" },
          NOTE,
        ],
      },
    ],
    jobFields: [
      { key: "gas_appliances", label: "Gas appliances in the home", type: "text", help: "e.g. ducted gas heater, gas cooktop. Gas safety check needed before sealing." },
      { key: "flueless_heater", label: "Flueless or open-flued gas heater?", type: "yesno" },
      NOTE,
    ],
  },
  showerhead: {
    id: "showerhead",
    version: "2026-11-23",
    title: "Showerheads",
    intro: "Add each shower. A bucket test: litres collected in 10 seconds x 6 = litres per minute (4-star is 9 L/min or less).",
    itemKinds: [
      {
        kind: "showerhead", label: "Shower", placeholder: "e.g. Main bathroom",
        fields: [
          { key: "flow_lpm", label: "Flow (bucket test)", type: "number", unit: "L/min" },
          { key: "current_stars", label: "Current WELS rating, if shown", type: "choice", options: ["Unknown", "1", "2", "3", "4", "5", "6"] },
          { key: "fitting", label: "Fitting", type: "choice", options: ["Fixed head", "Hand-held on rail", "Combination", "Other"] },
          NOTE,
        ],
      },
    ],
    jobFields: [{ key: "water_pressure", label: "Water pressure", type: "choice", options: ["Normal", "Low", "Very low"] }, NOTE],
  },
  insulation: {
    id: "insulation",
    version: "2026-11-23",
    title: "Ceiling insulation",
    intro: "Measure the ceiling area to insulate and photograph the roof space from the manhole.",
    itemKinds: [],
    jobFields: [
      { key: "area_m2", label: "Ceiling area to insulate", type: "number", unit: "m²" },
      { key: "existing", label: "Existing insulation", type: "choice", options: ["None", "Partial", "Full but thin", "Full", "Couldn't see"] },
      { key: "existing_r", label: "Existing R-value or depth", type: "text", help: "e.g. R2.5 batts, 50 mm loose fill" },
      { key: "joist_mm", label: "Gap between joists", type: "number", unit: "mm" },
      { key: "access", label: "Roof access", type: "choice", options: ["Manhole, easy", "Manhole, tight", "No manhole", "Unsafe"] },
      { key: "manhole_location", label: "Manhole location", type: "text" },
      { key: "non_ic4_downlights", label: "Non-IC4 downlights", type: "number", unit: "count" },
      { key: "hazards", label: "Hazards seen (asbestos, vermin, damaged wiring)", type: "text" },
      NOTE,
    ],
  },
  heating_cooling: {
    id: "heating_cooling",
    version: "2026-11-23",
    title: "Heating and cooling",
    intro: "Add the room the new unit will serve. Note where the indoor and outdoor units could go and the cable run back to the switchboard.",
    itemKinds: [
      {
        kind: "room", label: "Room", placeholder: "e.g. Main living room",
        fields: [
          { key: "length_m", label: "Length", type: "number", unit: "m" },
          { key: "width_m", label: "Width", type: "number", unit: "m" },
          { key: "height_m", label: "Ceiling height", type: "number", unit: "m" },
          { key: "existing", label: "Existing heating or cooling", type: "text" },
          { key: "indoor_location", label: "Indoor unit location", type: "text" },
          { key: "outdoor_location", label: "Outdoor unit location", type: "text" },
          { key: "pipe_run_m", label: "Pipe run indoor to outdoor", type: "number", unit: "m" },
          { key: "cable_run_m", label: "Cable run to switchboard", type: "number", unit: "m" },
          NOTE,
        ],
      },
    ],
    jobFields: [
      { key: "switchboard", label: "Switchboard", type: "choice", options: ["Modern with spare space", "Modern, full", "Old (ceramic fuses)", "Couldn't see"] },
      { key: "supply", label: "Supply", type: "choice", options: ["Single phase", "Three phase", "Unknown"] },
      NOTE,
    ],
  },
  lighting: {
    id: "lighting",
    version: "2026-11-23",
    title: "Lighting",
    intro: "Count downlights that aren't IC4-rated (they must be replaced before ceiling insulation).",
    itemKinds: [],
    jobFields: [
      { key: "non_ic4_downlights", label: "Non-IC4 downlights", type: "number", unit: "count" },
      { key: "rooms", label: "Rooms they're in", type: "text" },
      NOTE,
    ],
  },
  hot_water: {
    id: "hot_water",
    version: "2026-11-23",
    title: "Hot water",
    intro: "Photograph the system's compliance plate.",
    itemKinds: [],
    jobFields: [
      { key: "type", label: "Current system", type: "choice", options: ["Electric storage", "Gas storage", "Gas instantaneous", "Heat pump", "Solar", "Other"] },
      { key: "size_l", label: "Tank size", type: "number", unit: "L" },
      { key: "age", label: "Age or install year", type: "text" },
      { key: "location", label: "Location", type: "text" },
      NOTE,
    ],
  },
};

// Airtable Activity Type -> quote definition.
const BY_ACTIVITY: Record<string, string> = {
  draughtproofing: "draughtproofing", "draught proofing": "draughtproofing", draughtsealing: "draughtproofing", "draught sealing": "draughtproofing",
  showerhead: "showerhead", showerheads: "showerhead", "shower head": "showerhead", "shower heads": "showerhead",
  insulation: "insulation", "ceiling insulation": "insulation",
  "heating/cooling": "heating_cooling", heating: "heating_cooling", cooling: "heating_cooling", "heating and cooling": "heating_cooling",
  lighting: "lighting",
  "hot water": "hot_water",
};

export function quoteDefFor(activityType: string | null | undefined): QuoteDef | null {
  const id = BY_ACTIVITY[(activityType ?? "").trim().toLowerCase()];
  return id ? QUOTE_DEFS[id] : null;
}

export function quoteKind(def: QuoteDef, kind: string): QKind | undefined {
  return def.itemKinds.find((k) => k.kind === kind);
}

/** Keep only known fields, trimmed; numbers must parse (commas allowed). */
export function cleanValues(fields: QField[], input: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const raw = String(input[f.key] ?? "").trim();
    if (!raw) continue;
    if (f.type === "number") {
      const n = Number(raw.replace(/,/g, ""));
      if (Number.isFinite(n) && n >= 0) out[f.key] = String(n);
    } else if (f.type === "choice") {
      if (f.options.includes(raw)) out[f.key] = raw;
    } else if (f.type === "yesno") {
      if (raw === "yes" || raw === "no") out[f.key] = raw;
    } else {
      out[f.key] = raw.slice(0, 500);
    }
  }
  return out;
}

/** The quote measurements stored on an item (details keys with the q_ prefix, prefix removed). */
export function quoteValues(details: Record<string, string> | null | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(details ?? {}).filter(([k]) => k.startsWith(PREFIX)).map(([k, v]) => [k.slice(PREFIX.length), v]));
}

/** Merge new quote values into an item's details, keeping the installer's (unprefixed) keys. */
export function mergeQuoteDetails(details: Record<string, string> | null | undefined, values: Record<string, string>): Record<string, string> {
  const kept = Object.fromEntries(Object.entries(details ?? {}).filter(([k]) => !k.startsWith(PREFIX)));
  return { ...kept, ...Object.fromEntries(Object.entries(values).map(([k, v]) => [PREFIX + k, v])) };
}

/** Merge the installer's values into details, keeping the quote (q_) keys. */
export function mergeWorksDetails(details: Record<string, string> | null | undefined, values: Record<string, string>): Record<string, string> {
  const kept = Object.fromEntries(Object.entries(details ?? {}).filter(([k]) => k.startsWith(PREFIX)));
  return { ...kept, ...values };
}

const num = (v: string | undefined) => (v === undefined || v === "" ? null : Number(v));
const fmt = (n: number, dp = 1) => (Math.round(n * 10 ** dp) / 10 ** dp).toLocaleString("en-AU");

/** How many identical doors or windows one entry covers (blank or 0 means 1). */
export function qty(v: Record<string, string>): number {
  const n = num(v.qty);
  return n && n >= 1 ? Math.round(n) : 1;
}

/** Seal length for a door or window entry from its quote values, in metres, times its quantity (null if not measurable). */
export function sealMetres(kind: string, v: Record<string, string>): number | null {
  if (kind !== "door" && kind !== "window") return null;
  if (!v.needs || v.needs === "Nothing needed") return null;
  const w = num(v.width_mm), h = num(v.height_mm);
  if (v.needs === "Bottom seal only") return w ? (w / 1000) * qty(v) : null;
  if (!w || !h) return null;
  return ((2 * (w + h)) / 1000) * qty(v); // full perimeter; "Part of frame" is shown as up to the full perimeter
}

export function totals(def: QuoteDef, items: QItem[], answers: Record<string, string>): Total[] {
  const out: Total[] = [];
  const q = items.map((i) => ({ ...i, v: quoteValues(i.details) }));
  if (def.id === "draughtproofing") {
    const needing = (kind: string) =>
      q.filter((i) => i.kind === kind && i.v.needs && i.v.needs !== "Nothing needed" && i.v.needs !== "no").reduce((s, i) => s + qty(i.v), 0);
    const doors = needing("door"), windows = needing("window");
    const vents = q.filter((i) => i.kind === "vent" && i.v.needs === "yes").length;
    const metres = q.reduce((s, i) => s + (sealMetres(i.kind, i.v) ?? 0), 0);
    const partial = q.some((i) => i.v.needs === "Part of frame");
    const unmeasured = q.filter((i) => (i.kind === "door" || i.kind === "window") && i.v.needs && i.v.needs !== "Nothing needed" && sealMetres(i.kind, i.v) === null).length;
    out.push({ label: "Doors needing sealing", value: String(doors) });
    out.push({ label: "Windows needing sealing", value: String(windows) });
    out.push({ label: "Vents to seal", value: String(vents) });
    out.push({ label: partial ? "Seal length (up to)" : "Seal length", value: `${fmt(metres)} m` });
    if (unmeasured) out.push({ label: "Still to measure", value: `${unmeasured} door${unmeasured === 1 ? "" : "s"} or window${unmeasured === 1 ? "" : "s"}` });
  } else if (def.id === "showerhead") {
    const shows = q.filter((i) => i.kind === "showerhead");
    const over = shows.filter((i) => (num(i.v.flow_lpm) ?? 0) > 9).length;
    out.push({ label: "Showers", value: String(shows.length) });
    out.push({ label: "Over 9 L/min", value: String(over) });
  } else if (def.id === "heating_cooling") {
    for (const r of q.filter((i) => i.kind === "room")) {
      const l = num(r.v.length_m), w = num(r.v.width_m), h = num(r.v.height_m);
      if (l && w) out.push({ label: `${r.label} area`, value: `${fmt(l * w)} m²${h ? ` (${fmt(l * w * h)} m³)` : ""}` });
    }
  } else if (def.id === "insulation" && answers.area_m2) {
    out.push({ label: "Area to insulate", value: `${fmt(Number(answers.area_m2))} m²` });
  }
  return out;
}

function show(f: QField, v: string): string {
  if (f.type === "number") return `${v} ${f.unit === "count" ? "" : f.unit}`.trim();
  if (f.type === "yesno") return v === "yes" ? "Yes" : "No";
  return v;
}

/** Plain-text summary of one upgrade's visit, for pasting into Airtable notes, a tender or a quote. */
export function visitText(def: QuoteDef, items: QItem[], answers: Record<string, string>): string {
  const lines: string[] = [`${def.title} (site measure)`];
  for (const t of totals(def, items, answers)) lines.push(`${t.label}: ${t.value}`);
  for (const i of items) {
    const k = quoteKind(def, i.kind);
    if (!k) continue;
    const v = quoteValues(i.details);
    const parts = k.fields.filter((f) => v[f.key]).map((f) => (f.key === "note" ? v[f.key] : `${f.label.toLowerCase()} ${show(f, v[f.key])}`));
    if (v.width_mm && v.height_mm) {
      parts.splice(0, parts.length, ...parts.filter((p) => !p.startsWith("width") && !p.startsWith("height") && !p.startsWith("how many")));
      parts.unshift(`${v.width_mm} x ${v.height_mm} mm${qty(v) > 1 ? ` (x${qty(v)})` : ""}`);
    }
    lines.push(`- ${i.label} (${k.label.toLowerCase()}): ${parts.join("; ") || "not measured"}`);
  }
  for (const f of def.jobFields) if (answers[f.key]) lines.push(`${f.label}: ${show(f, answers[f.key])}`);
  return lines.join("\n");
}
