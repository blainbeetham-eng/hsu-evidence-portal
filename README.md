# HomeStar Evidence Portal

Login-protected portal where HomeStar Upgrades records before/during/after evidence for
Victorian rental minimum-standards upgrades. Planned at portal.homestarupgrades.com.

Build reference: `HSU_Evidence_Portal_Spec.md` (v0.3, Google Drive, "HSU rentals" folder).
This is a separate app from app.homestarupgrades.com (`homestar-assessment`), which is not changed.

## Phase 1 (this code)

- Supabase (Sydney) Postgres with Row Level Security for admin, agency_user, landlord and installer.
  Only the admin account is used in Phase 1; the other roles' rules are tested with seeded users.
- Read-only Airtable sync (daily cron + "Sync now"), restricted to an explicit field allowlist
  (`src/lib/airtable/allowlist.ts`). No supplier cost, margin or quote data is ever read or stored.
- Admin sign-in by emailed link plus an authenticator app (MFA required).
- Admin screens: overview and sync log, properties, work orders.

## Local development

```bash
npm install
cp .env.example .env.local   # then fill in the values yourself
npm run dev
```

## Checks

```bash
npm test          # RLS tests (in-memory Postgres) + sync and allowlist tests
npm run typecheck
npm run lint
npm run build
```

## Database

Migrations live in `supabase/migrations`. Apply to the linked Supabase project with:

```bash
npx supabase link --project-ref <ref>
npx supabase db push
```

## Deploy

Vercel project with functions pinned to Sydney (`vercel.json`). Set the variables from
`.env.example` in Vercel. The cron in `vercel.json` calls `/api/sync/airtable` daily at
19:00 UTC (5–6am Melbourne).

## Supabase settings that live outside this repo

- Authentication → Sign In / Providers: email on, **Allow new users to sign up off**.
- Authentication → URL Configuration: redirect URLs include `http://localhost:3000/auth/callback`
  and `https://portal.homestarupgrades.com/auth/callback`; Site URL is the live portal address.
- Authentication → Emails → SMTP: Resend (`smtp.resend.com`, port 465, user `resend`), sender
  `portal@homestarupgrades.com`. DNS records for Resend are in GoDaddy.
- Authentication → Emails → Templates → Magic Link: body as in `supabase/templates/magic_link.html`.
  It uses `token_hash` so links work in any browser. The default template's `{{ .ConfirmationURL }}`
  only works in the browser that requested the link.

## Making someone an admin

1. Supabase dashboard → Authentication → Users → Add user → **Create new user** (their email,
   tick auto-confirm). Don't use "Invite user": the default invite email isn't compatible yet (Phase 1b).
2. SQL editor: `insert into public.profiles (id, role, full_name) select id, 'admin', 'Name' from auth.users where email = 'them@example.com';`
3. They sign in from the login page and set up an authenticator app at first sign-in.
