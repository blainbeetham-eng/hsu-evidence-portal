# HSU Evidence Portal — notes for Claude

- Build reference: `HSU_Evidence_Portal_Spec.md` (Google Drive, "HSU rentals" folder; search by title).
  Business context: `HSU_Master_Reference.md` (same folder). Update the master reference as the last step of every phase.
- Next.js 16 (App Router). Version-matched docs are in `node_modules/next/dist/docs/`. `middleware.ts` is `src/proxy.ts` in 16.
- Airtable (base `appB1rWuqM3XsYHQz`) is the system of record. The portal reads only; it never writes Pipeline Status.
- Never read, store or display supplier cost, margin, quoted amounts or Supplier quotes data. The only Airtable fields
  the portal may read are in `src/lib/airtable/allowlist.ts`; `tests/sync/allowlist.test.ts` enforces it.
- Access control lives in Postgres RLS (`supabase/migrations`). Pages read with the signed-in user's client
  (`createClient` in `src/lib/supabase/server.ts`); the secret-key client is only for the sync after authorisation.
  Every policy change needs a test in `tests/db/rls.test.ts`.
- No secrets in the repo. Values live in `.env.local` and Vercel env vars.
- Keep it simple: Blain prefers the smallest change that solves the real problem.
