-- Phase 2A, Assessment stage (HSU_Evidence_Portal_Spec.md v0.7, Sections 3C-3E).
--
--   * evidence_files: assessment reports, photos and videos, one row per stored file.
--     Files live in the private Storage bucket "evidence"; nothing is ever public.
--   * report_summaries: the AI summary of each report. Only an approved version is
--     visible outside HSU; drafts, hidden and superseded versions are admin-only.
--   * report_extras: admin-only facts about a report (the DI online-report link),
--     kept out of evidence_files so no client role can ever select them.
--   * Admin (with MFA) is the only writer. Rows are never deleted: hiding or
--     soft-deleting keeps the history. Landlords and agencies read only what isn't
--     hidden, for properties they can already see.
--
-- Rollback: drop the three tables, the two app functions, the storage policies and
-- the "evidence" bucket (after copying its files out).

-- Work order's Drive job folder (Airtable Drive Folder Link), for Import from Drive.
alter table public.work_orders add column drive_folder_url text;

create table public.evidence_files (
  id             uuid primary key default gen_random_uuid(),
  work_order_id  text not null,
  kind           text not null check (kind in ('report', 'photo', 'video')),
  stage          text not null default 'assessment' check (stage in ('assessment', 'works', 'completion')),
  storage_path   text not null unique,
  poster_path    text unique,           -- video still image
  file_name      text not null,
  mime           text,
  size_bytes     bigint,
  sha256         text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  source         text not null check (source in ('drive_import', 'admin_upload')),
  drive_file_id  text,
  taken_at       timestamptz,
  duration_s     numeric,
  hidden         boolean not null default false,
  uploaded_by    uuid references auth.users (id),
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  delete_reason  text
);

create index evidence_files_work_order_idx on public.evidence_files (work_order_id);
create unique index evidence_files_drive_file_idx on public.evidence_files (drive_file_id)
  where drive_file_id is not null;

create table public.report_extras (
  report_id      uuid primary key references public.evidence_files (id),
  di_report_url  text
);

create table public.report_summaries (
  id              uuid primary key default gen_random_uuid(),
  report_id       uuid not null references public.evidence_files (id),
  version         int not null,
  body            text not null,
  status          text not null default 'draft' check (status in ('draft', 'approved', 'hidden', 'superseded')),
  source          text not null default 'ai' check (source in ('ai', 'manual')),
  model           text,
  prompt_version  text,
  report_sha256   text,
  created_by      uuid references auth.users (id),
  created_at      timestamptz not null default now(),
  approved_by     uuid references auth.users (id),
  approved_at     timestamptz,
  unique (report_id, version)
);

-- One approved summary per report at a time.
create unique index report_summaries_one_approved_idx on public.report_summaries (report_id)
  where status = 'approved';

-- ---------------------------------------------------------------------------
-- Visibility helpers
-- ---------------------------------------------------------------------------

create function app.can_see_evidence_file(p_file_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.evidence_files f
    where f.id = p_file_id
      and (app.is_admin() or (not f.hidden and f.deleted_at is null and app.can_see_work_order(f.work_order_id)))
  )
$$;

-- Storage: a file (or a video's still image) is readable by whoever can see its row.
create function app.can_read_evidence_object(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_admin() or exists (
    select 1 from public.evidence_files f
    where (f.storage_path = p_path or f.poster_path = p_path)
      and not f.hidden and f.deleted_at is null
      and app.can_see_work_order(f.work_order_id)
  )
$$;

grant execute on function app.can_see_evidence_file(uuid), app.can_read_evidence_object(text) to authenticated;
revoke execute on function app.can_see_evidence_file(uuid), app.can_read_evidence_object(text) from public, anon;

-- ---------------------------------------------------------------------------
-- Grants and RLS. Admin writes through RLS with the signed-in client; nobody deletes.
-- ---------------------------------------------------------------------------

revoke all on public.evidence_files, public.report_extras, public.report_summaries from anon, authenticated;
grant select, insert, update on public.evidence_files, public.report_extras, public.report_summaries to authenticated;

alter table public.evidence_files   enable row level security;
alter table public.report_extras    enable row level security;
alter table public.report_summaries enable row level security;

create policy evidence_files_read on public.evidence_files for select to authenticated
  using (app.can_see_evidence_file(id));
create policy evidence_files_admin_insert on public.evidence_files for insert to authenticated
  with check ((select app.is_admin()) and uploaded_by = (select auth.uid()));
create policy evidence_files_admin_update on public.evidence_files for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

create policy report_extras_admin on public.report_extras for all to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

create policy report_summaries_read on public.report_summaries for select to authenticated
  using ((select app.is_admin()) or (status = 'approved' and app.can_see_evidence_file(report_id)));
create policy report_summaries_admin_insert on public.report_summaries for insert to authenticated
  with check ((select app.is_admin()) and created_by = (select auth.uid()));
create policy report_summaries_admin_update on public.report_summaries for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

-- Admin actions are recorded in the audit log by the admin's own session.
grant insert on public.audit_log to authenticated;
create policy audit_log_admin_insert on public.audit_log for insert to authenticated
  with check ((select app.is_admin()) and actor = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Storage bucket. Private; 2 GB per file (DI videos); only these file types.
-- Upload: admin only. Read: per row visibility above. No update or delete policy,
-- so stored evidence can't be replaced or removed through the API.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidence', 'evidence', false, 2147483648, array[
  'application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp',
  'video/mp4', 'video/quicktime'
]);

create policy evidence_objects_read on storage.objects for select to authenticated
  using (bucket_id = 'evidence' and app.can_read_evidence_object(name));
create policy evidence_objects_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'evidence' and (select app.is_admin()));
