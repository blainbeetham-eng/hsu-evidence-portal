import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runSync } from "@/lib/sync/run-sync";
import { supabaseStore } from "@/lib/sync/supabase-store";
import { createServiceClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called by Vercel Cron (vercel.json), which sends "Authorization: Bearer <CRON_SECRET>".
export async function GET(request: NextRequest) {
  if (!authorised(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const result = await runSync({
    trigger: "cron",
    token: serverEnv.airtableToken(),
    store: supabaseStore(createServiceClient()),
  });

  return NextResponse.json(result, { status: result.status === "succeeded" ? 200 : 500 });
}

function authorised(header: string | null): boolean {
  const expected = Buffer.from(`Bearer ${serverEnv.cronSecret()}`);
  const actual = Buffer.from(header ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
