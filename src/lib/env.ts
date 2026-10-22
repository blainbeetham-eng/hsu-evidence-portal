// Environment variables. Values live in .env.local (local) and Vercel project
// settings (deployed). Never commit real values.

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return v;
}

export const publicEnv = {
  // Read directly so Next.js can inline them into browser code.
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabasePublishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
};

export const serverEnv = {
  supabaseSecretKey: () => required("SUPABASE_SECRET_KEY"),
  airtableToken: () => required("AIRTABLE_TOKEN"),
  cronSecret: () => required("CRON_SECRET"),
};
