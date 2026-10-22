import Link from "next/link";

export const PAGE_SIZE = 50;

/** Escape LIKE wildcards so user input matches literally. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function Pager({
  page,
  total,
  params,
}: {
  page: number;
  total: number;
  params: Record<string, string | undefined>;
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return s ? `?${s}` : "?";
  };
  return (
    <p className="muted small" style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
      <span>{total} total · page {page} of {pages}</span>
      {page > 1 && <Link href={href(page - 1)}>← Previous</Link>}
      {page < pages && <Link href={href(page + 1)}>Next →</Link>}
    </p>
  );
}
