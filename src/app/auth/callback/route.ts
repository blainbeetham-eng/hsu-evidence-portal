import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// Landing point for magic links and invite links. Supports both the PKCE code
// flow and token_hash links.
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const supabase = await createClient();

  let error: { message: string } | null = { message: "no code or token_hash in link" };
  if (code) {
    ({ error } = await supabase.auth.exchangeCodeForSession(code));
  } else if (tokenHash && type) {
    ({ error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type }));
  }
  if (error) console.warn(`auth callback rejected (${code ? "code" : tokenHash ? "token_hash" : "none"}): ${error.message}`);

  return NextResponse.redirect(new URL(error ? "/login?error=link" : "/mfa", url.origin));
}
