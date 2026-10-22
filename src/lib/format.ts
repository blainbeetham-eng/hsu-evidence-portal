const TZ = "Australia/Melbourne";

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone: TZ }).format(new Date(iso));
}

export function formatDate(isoDate: string | null | undefined): string {
  if (!isoDate) return "—";
  // Date-only values (YYYY-MM-DD) are calendar dates, not instants.
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}
