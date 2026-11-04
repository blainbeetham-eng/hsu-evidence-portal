// Works checklists (spec v0.8 Section 6). Templates are data: change wording here and bump
// the version. Each job's answers record the version they were made against.
// Claude's reading of S.R. No. 63/2025; a qualified person must review before agencies
// rely on compliance status (spec Section 11, question 3).

export type Slot = { key: string; label: string; phase: "before" | "during" | "after" };
export type ItemKind = { kind: string; label: string; slots: Slot[]; fields: Field[] };
export type Field =
  | { key: string; label: string; type: "yesno"; help?: string }
  | { key: string; label: string; type: "text"; help?: string }
  | { key: string; label: string; type: "choice"; options: string[]; help?: string };
export type Template = {
  id: string;
  version: string;
  title: string;
  regulation: string;
  intro: string;
  itemKinds: ItemKind[];
  jobSlots: Slot[]; // photos for the job as a whole (e.g. product label)
  questions: Field[]; // job-level screens
};

const BEFORE_AFTER: Slot[] = [
  { key: "before", label: "Before", phase: "before" },
  { key: "after", label: "After", phase: "after" },
];
const OPERATES: Field = { key: "operates_normally", label: "Still opens and closes normally after sealing", type: "yesno" };

export const TEMPLATES: Record<string, Template> = {
  draughtproofing: {
    id: "draughtproofing",
    version: "2026-11-04",
    title: "Draughtproofing",
    regulation: "Schedule 4 cl 18 (agreements from 1 July 2027)",
    intro:
      "Add every external door, external window and unsealed wall vent. Photograph each one before and after sealing, around the whole frame.",
    itemKinds: [
      { kind: "door", label: "External door", slots: BEFORE_AFTER, fields: [OPERATES] },
      { kind: "window", label: "External window", slots: BEFORE_AFTER, fields: [OPERATES] },
      { kind: "vent", label: "Wall vent", slots: BEFORE_AFTER, fields: [] },
    ],
    jobSlots: [{ key: "product", label: "Sealing product and its instructions", phase: "during" }],
    questions: [
      { key: "flueless_heater", label: "Is there a flueless space heater or open-flued gas appliance?", type: "yesno",
        help: "If yes, take a photo of it. The home may be excluded from draughtproofing (cl 18(4)(a)); tell HSU before sealing." },
      { key: "kitchen_flueless_cooking", label: "Kitchen: flueless gas cooking appliance without a rangehood?", type: "yesno",
        help: "If yes, the kitchen may be excluded (cl 18(5)(b)). Take a photo." },
      { key: "owners_corp", label: "Apartment where owners corporation rules stop sealing external doors?", type: "yesno" },
      { key: "heritage", label: "Heritage restriction mentioned by the owner or agent?", type: "yesno" },
      { key: "site_note", label: "Anything you couldn't seal, and why", type: "text" },
    ],
  },
  showerhead: {
    id: "showerhead",
    version: "2026-11-04",
    title: "Showerheads",
    regulation: "Schedule 4 cl 4(c); regs 24(1)(ad), 31(1)(h)",
    intro: "Add each shower. Photograph the old head, the new head installed, and the WELS star label or packaging.",
    itemKinds: [
      {
        kind: "showerhead",
        label: "Shower",
        slots: [
          { key: "before", label: "Old head", phase: "before" },
          { key: "after", label: "New head installed", phase: "after" },
          { key: "label", label: "WELS label or box", phase: "after" },
        ],
        fields: [
          { key: "stars", label: "WELS star rating of the new head", type: "choice", options: ["3", "4", "5", "6"] },
          { key: "model", label: "Brand and model", type: "text" },
          { key: "three_star_reason", label: "If 3-star: why a 4-star couldn't be fitted or won't work", type: "text",
            help: "For example low water pressure or old plumbing. Take a photo if you can." },
        ],
      },
    ],
    jobSlots: [],
    questions: [{ key: "site_note", label: "Anything you couldn't do, and why", type: "text" }],
  },
};

// Airtable Activity Type -> template (spec Section 10, Phase 2B). Others come later.
const BY_ACTIVITY: Record<string, string> = {
  draughtproofing: "draughtproofing",
  "draught proofing": "draughtproofing",
  draughtsealing: "draughtproofing",
  "draught sealing": "draughtproofing",
  showerhead: "showerhead",
  showerheads: "showerhead",
  "shower head": "showerhead",
  "shower heads": "showerhead",
};

export function templateFor(activityType: string | null | undefined): Template | null {
  const id = BY_ACTIVITY[(activityType ?? "").trim().toLowerCase()];
  return id ? TEMPLATES[id] : null;
}

export function itemKind(t: Template, kind: string): ItemKind | undefined {
  return t.itemKinds.find((k) => k.kind === kind);
}

export const COMPLIANCE_STATUSES = [
  { value: "not_assessed", label: "Not assessed" },
  { value: "not_yet_applicable", label: "Not yet applicable" },
  { value: "evidence_pending", label: "Evidence pending" },
  { value: "evidenced_compliant", label: "Evidenced compliant" },
  { value: "exempt_recorded", label: "Exempt (recorded)" },
  { value: "non_compliant", label: "Non-compliant" },
] as const;

export function statusLabel(value: string | null | undefined): string {
  return COMPLIANCE_STATUSES.find((s) => s.value === value)?.label ?? "Not set";
}

/** Plain-English works status from Airtable's Pipeline Status (spec 3C). */
export function worksStage(pipelineStatus: string | null | undefined): string {
  const s = (pipelineStatus ?? "").toLowerCase();
  if (s.includes("invoice") || s.includes("upgrade complete")) return "Done";
  if (s.includes("works scheduled")) return "Scheduled";
  return "Not started";
}
