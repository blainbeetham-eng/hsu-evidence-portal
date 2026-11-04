// Which minimum standard applies to an upgrade, from the property's lease renewal date
// (spec Section 6.1, decision D6). The renewal date stands in for "agreement entered into
// or created on or after". Blank date = not assessed, never assumed either way.

export type Applicability =
  | { state: "not_assessed"; text: string }
  | { state: "not_yet"; from: string; text: string }
  | { state: "applies"; from: string; text: string }
  | { state: "evidence_only"; text: string };

const RULES: Record<string, { from: string; clause: string }> = {
  insulation: { from: "2027-03-01", clause: "ceiling insulation, cl 17" },
  draughtproofing: { from: "2027-07-01", clause: "draughtproofing, cl 18" },
  showerheads: { from: "2027-03-01", clause: "shower head, cl 4(c)" },
  "heating/cooling": { from: "2027-03-01", clause: "heating cl 14, cooling cl 16" },
  "hot water": { from: "2027-03-01", clause: "water heater, cl 19" },
};
const COOLING_2030 = "2030-07-01";

const long = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, d)));
};

export function applicability(activityType: string | null | undefined, leaseRenewalDate: string | null | undefined): Applicability {
  const key = (activityType ?? "").trim().toLowerCase();
  if (key === "lighting") return { state: "evidence_only", text: "Not a minimum standard on its own; recorded because it affects ceiling insulation." };
  const rule = RULES[key];
  if (!rule) return { state: "not_assessed", text: "No standard mapped for this upgrade type." };
  if (!leaseRenewalDate) return { state: "not_assessed", text: "Not assessed: no lease renewal date yet." };

  if (leaseRenewalDate < rule.from) {
    return {
      state: "not_yet",
      from: rule.from,
      text: `Not yet: the standard (${rule.clause}) applies to agreements from ${long(rule.from)}. The renewal on ${long(leaseRenewalDate)} is before that, so it applies at the following renewal.`,
    };
  }
  let text = `Applies at the renewal on ${long(leaseRenewalDate)} (${rule.clause}; agreements from ${long(rule.from)}).`;
  if (key === "heating/cooling" && leaseRenewalDate >= COOLING_2030) {
    text += ` The stricter cooling standard (cl 16(3)) applies from ${long(COOLING_2030)}.`;
  }
  return { state: "applies", from: rule.from, text };
}
