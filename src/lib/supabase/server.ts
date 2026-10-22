import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { publicEnv, serverEnv } from "@/lib/env";

/** Client acting as the signed-in user. Every query goes through RLS. */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component, where cookies are read-only. The proxy refreshes the session.
        }
      },
    },
  });
}

/**
 * Client with the secret key. Bypasses RLS. Use only in the sync and only after
 * the caller has been authorised (cron secret or verified admin).
 */
export function createServiceClient() {
  return createPlainClient(publicEnv.supabaseUrl, serverEnv.supabaseSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
