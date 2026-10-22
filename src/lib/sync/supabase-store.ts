import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MirrorTable, Row, SyncStore } from "./run-sync";

const CHUNK = 500;

/** SyncStore backed by Supabase with the secret (service role) key. Server only. */
export function supabaseStore(db: SupabaseClient): SyncStore {
  return {
    async startRun(trigger, triggeredBy) {
      const { data, error } = await db
        .from("sync_runs")
        .insert({ trigger, triggered_by: triggeredBy })
        .select("id")
        .single();
      if (error) throw new Error(`sync_runs insert: ${error.message}`);
      return data.id as number;
    },

    async finishRun(runId, r) {
      const { error } = await db
        .from("sync_runs")
        .update({
          status: r.status,
          counts: r.counts,
          unexpected_fields: r.unexpectedFields ?? [],
          error: r.error ?? null,
          finished_at: new Date().toISOString(),
        })
        .eq("id", runId);
      if (error) throw new Error(`sync_runs update: ${error.message}`);
    },

    async countActive(table: MirrorTable) {
      const { count, error } = await db.from(table).select("id", { count: "exact", head: true }).is("removed_at", null);
      if (error) throw new Error(`${table} count: ${error.message}`);
      return count ?? 0;
    },

    async upsert(table: MirrorTable, rows: Row[]) {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error } = await db.from(table).upsert(rows.slice(i, i + CHUNK), { onConflict: "id" });
        if (error) throw new Error(`${table} upsert: ${error.message}`);
      }
    },

    async markRemoved(table: MirrorTable, syncedBefore: string) {
      const { data, error } = await db
        .from(table)
        .update({ removed_at: new Date().toISOString() })
        .lt("synced_at", syncedBefore)
        .is("removed_at", null)
        .select("id");
      if (error) throw new Error(`${table} mark removed: ${error.message}`);
      return data?.length ?? 0;
    },
  };
}
