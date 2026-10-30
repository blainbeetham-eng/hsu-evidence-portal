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

## Backups

Separate from Supabase's own daily backups, which don't cover Storage files.

- **Where:** AWS S3 bucket `hsu-portal-backup-syd` (Sydney), versioned, Object Lock Governance 35 days.
  Lifecycle rule `expire-database-copies` removes `db/` copies after 35 days; `files/` copies are kept.
- **Nightly job:** `.github/workflows/nightly-backup.yml`, 16:00 UTC. Database as `db/<timestamp>/`
  (roles, schema, data from `supabase db dump`); new Storage files as `files/<bucket>/<path>` with a
  `sha256` metadata value. GitHub emails the repo owner if a scheduled run fails.
- **Access:** IAM user `hsu-portal-backup-writer`, inline policy `backup-add-files-only` (list and add
  only). Keys are GitHub secrets `AWS_BACKUP_ACCESS_KEY_ID` / `AWS_BACKUP_SECRET_ACCESS_KEY`; Supabase
  access is `SUPABASE_DB_URL` (session pooler) and `SUPABASE_BACKUP_SECRET_KEY` (secret key `github_backup`).
- **Restore test** (before Phase 2A goes live, then quarterly): temporarily add `"s3:GetObject"` to the
  second statement of `backup-add-files-only`, run `.github/workflows/restore-test.yml` from the Actions
  tab, then remove it. Record the date, time taken and result in HSU_Master_Reference.md.
- **Real restore:** download `db/<timestamp>/` and run, against the target database,
  `psql --single-transaction -v ON_ERROR_STOP=1 -f roles.sql -f schema.sql -c 'SET session_replication_role = replica' -f data.sql`,
  then copy `files/<bucket>/` back into Storage.

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
