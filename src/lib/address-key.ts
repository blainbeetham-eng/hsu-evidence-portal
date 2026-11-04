// Address Key, as in Airtable Properties -> Address Key (flddQJN45TYpyAsWk). These steps
// are copied from "HSU Rental/Claude build/address_key_formula.js"; change both together.

const TYPES: [string, string][] = [
  ["avenue", "ave"], ["street", "st"], ["road", "rd"], ["drive", "dr"], ["court", "ct"], ["crescent", "cres"],
  ["place", "pl"], ["parade", "pde"], ["boulevard", "blvd"], ["terrace", "tce"], ["lane", "ln"], ["grove", "gr"],
  ["close", "cl"], ["highway", "hwy"], ["square", "sq"], ["circuit", "cct"], ["esplanade", "esp"],
];
const STEPS: [RegExp, string][] = [
  [/[,.]/g, " "],
  [/\//g, " "],
  [/\b(unit|apartment|apt|flat)\b/g, " "],
  [/\s+/g, " "],
  [/\s*\baustralia\s*$/g, ""],
  [/\s*\b\d{4}\s*$/g, ""],
  [/\s*\b(vic|victoria)\s*$/g, ""],
  [/\s*\b\d{4}\s*$/g, ""],
  ...TYPES.map(([a, b]) => [new RegExp(`\\b${a}\\b`, "g"), b] as [RegExp, string]),
  [/\bsth\b/g, "south"],
  [/\bnth\b/g, "north"],
  [/\bmt\b/g, "mount"],
  [/\s+/g, " "],
];

export function addressKey(address: string): string {
  let e = address.trim().toLowerCase();
  for (const [re, rep] of STEPS) e = e.replace(re, rep);
  return e.trim();
}

const SHORT_TYPES = new Set(TYPES.map(([, b]) => b));

/** "31 grandview ave glen iris" -> "31 grandview ave" (number, street name and type). */
function streetPart(key: string): string | null {
  const words = key.split(" ");
  const i = words.findIndex((w, n) => n > 0 && SHORT_TYPES.has(w));
  return i > 0 && /\d/.test(words[0]) ? words.slice(0, i + 1).join(" ") : null;
}

const contains = (haystack: string, needle: string) => ` ${haystack} `.includes(` ${needle} `);

/**
 * The property an email subject refers to. A full key match wins; otherwise the street
 * part (number, name, type) when only one property has it. Null when unsure.
 */
export function matchProperty<T extends { id: string; address: string }>(subject: string, properties: T[]): T | null {
  const s = addressKey(subject.replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, ""));
  const hits = properties.map((p) => ({ p, k: addressKey(p.address) })).filter(({ k }) => contains(s, k));
  // "3 12 smith st kew" also contains "12 smith st kew": the longer (unit) address wins.
  const full = hits.filter(({ k }) => !hits.some((o) => o.k !== k && contains(o.k, k))).map(({ p }) => p);
  if (full.length === 1) return full[0];
  if (full.length > 1) return null;
  const street = properties.filter((p) => {
    const sp = streetPart(addressKey(p.address));
    return sp !== null && contains(s, sp);
  });
  return street.length === 1 ? street[0] : null;
}
