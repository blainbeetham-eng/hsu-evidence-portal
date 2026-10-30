// In-memory Postgres (PGlite) with the minimum of Supabase's auth schema and roles
// needed to run our migrations and exercise RLS exactly as PostgREST would:
// SET ROLE authenticated + request.jwt.claims.
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;
  create schema storage;
  create table storage.buckets (
    id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(), bucket_id text, name text
  );
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated;
  grant select, insert, update, delete on storage.objects to anon, authenticated;
  grant usage on schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  grant select, insert, update, delete on all tables in schema public to anon, authenticated;
  alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;
`;

// TEST_MIGRATIONS_DIR lets a mutation check point the suite at a deliberately broken copy.
const MIGRATIONS_DIR =
  process.env.TEST_MIGRATIONS_DIR ?? join(__dirname, "..", "..", "supabase", "migrations");

export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  return db;
}

export type Claims = { sub?: string; aal?: "aal1" | "aal2" };

/**
 * Run fn as a signed-in user (role authenticated) or as anon, then roll back.
 * setupSql, if given, runs first as the database owner inside the same transaction.
 */
export async function as<T>(
  db: PGlite,
  who: Claims | "anon",
  fn: (tx: Transaction) => Promise<T>,
  setupSql?: string,
): Promise<T> {
  let result!: T;
  await db
    .transaction(async (tx) => {
      if (setupSql) await tx.exec(setupSql);
      if (who === "anon") {
        await tx.exec("set local role anon");
      } else {
        await tx.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ role: "authenticated", ...who }),
        ]);
        await tx.exec("set local role authenticated");
      }
      result = await fn(tx);
      await tx.rollback();
    })
    .catch((e) => {
      if (!(e instanceof Error && /rollback/i.test(e.message))) throw e;
    });
  return result;
}

export async function ids(tx: Transaction, table: string): Promise<string[]> {
  const res = await tx.query<{ id: string }>(`select id::text as id from public.${table} order by id`);
  return res.rows.map((r) => r.id);
}
