-- Phase 2B, Works and Completion stages (HSU_Evidence_Portal_Spec.md v0.8, items 4-7;
-- Sections 3A, 3C, 3E, 5, 6).
--
--   * field_assignments: work orders given to HSU's own field team. The field team sees
--     only these jobs, through public.field_jobs() (address and upgrade only). They get
--     no row access to properties, work orders, contacts or anything with prices.
--   * job_items: the openings (doors, windows, vents) and showerheads on a job, each with
--     before and after photo slots; job_checklists: the job's yes/no screens.
--   * evidence_files gains review: field captures start as 'draft', go to 'pending' when
--     submitted, and only 'accepted' files are ever visible to landlords and agencies.
--     Existing (assessment) files are 'accepted'.
--   * inbox_items: emails received at the email-in address. Their files wait in the
--     Inbox (no work order yet) until Blain files them, or are filed automatically when
--     the sender is a known supplier on exactly one job at the matched property.
--   * upgrade_status: the compliance status Blain sets per upgrade (history kept).
--   * written_summaries: works summary per upgrade and completion summary per property,
--     draft then published, versioned. notes: with visibility levels (D1).
--
-- Rollback: drop the new tables, functions and policies below; restore the 2A versions
-- of evidence_files_read, app.can_see_evidence_file and app.can_read_evidence_object;
-- drop the added evidence_files columns once nothing uses them.

alter table public.profiles drop constraint profiles_role_link;
alter table public.profiles add constraint profiles_role_link check (
  (role = 'admin') or
  (role = 'field_team') or
  (role = 'agency_user' and agency_id is not null) or
  (role = 'landlord'    and contact_id is not null) or
  (role = 'installer'   and supplier_org_id is not null)
);

-- ---------------------------------------------------------------------------
-- Field team jobs
-- ---------------------------------------------------------------------------

create table public.field_assignments (
  work_order_id  text primary key,
  assigned_by    uuid references auth.users (id),
  assigned_at    timestamptz not null default now(),
  ended_at       timestamptz
);

create function app.field_assigned(p_work_order_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.my_role() = 'field_team' and exists (
    select 1 from public.field_assignments a
    join public.work_orders w on w.id = a.work_order_id and w.removed_at is null
    where a.work_order_id = p_work_order_id and a.ended_at is null
  )
$$;

-- The field team's job list: address and upgrade only. No landlord, agency or AI summary.
create function public.field_jobs()
returns table (work_order_id text, activity_type text, pipeline_status text, property_id text, address text, assigned_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select w.id, w.activity_type, w.pipeline_status, p.id, p.address, a.assigned_at
  from public.field_assignments a
  join public.work_orders w on w.id = a.work_order_id and w.removed_at is null
  join public.properties p on p.id = w.property_id and p.removed_at is null
  where a.ended_at is null and (app.my_role() = 'field_team' or app.is_admin())
  order by a.assigned_at desc
$$;

-- ---------------------------------------------------------------------------
-- Checklist items and answers
-- ---------------------------------------------------------------------------

create table public.job_items (
  id             uuid primary key default gen_random_uuid(),
  work_order_id  text not null,
  template       text not null,          -- draughtproofing | showerhead (src/lib/checklists.ts)
  kind           text not null,          -- door | window | vent | showerhead
  label          text not null,          -- e.g. "Front door", "Main bathroom"
  details        jsonb not null default '{}',
  created_by     uuid references auth.users (id),
  created_at     timestamptz not null default now(),
  removed_at     timestamptz
);
create index job_items_work_order_idx on public.job_items (work_order_id);

create table public.job_checklists (
  work_order_id     text primary key,
  template          text not null,
  template_version  text not null,
  answers           jsonb not null default '{}',
  updated_by        uuid references auth.users (id),
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Inbox (email-in)
-- ---------------------------------------------------------------------------

create table public.inbox_items (
  id                       uuid primary key default gen_random_uuid(),
  provider                 text not null default 'resend',
  provider_email_id        text unique,
  received_at              timestamptz not null default now(),
  from_email               text,
  from_name                text,
  subject                  text,
  body_text                text,
  supplier_org_id          text,           -- sender matched to a known supplier email
  suggested_property_id    text,           -- address in the subject matched by Address Key
  suggested_work_order_id  text,
  status                   text not null default 'new' check (status in ('new', 'filed', 'discarded')),
  filed_work_order_id      text,
  filed_by                 uuid references auth.users (id),  -- null = filed automatically
  filed_at                 timestamptz,
  discard_reason           text,
  skipped                  text[] not null default '{}'      -- attachments not kept, with reason
);

-- ---------------------------------------------------------------------------
-- evidence_files: works photos and documents, review states, capture location
-- ---------------------------------------------------------------------------

alter table public.evidence_files alter column work_order_id drop not null;
alter table public.evidence_files drop constraint evidence_files_kind_check;
alter table public.evidence_files add constraint evidence_files_kind_check
  check (kind in ('report', 'photo', 'video', 'document'));
alter table public.evidence_files drop constraint evidence_files_source_check;
alter table public.evidence_files add constraint evidence_files_source_check
  check (source in ('drive_import', 'admin_upload', 'field_capture', 'email_in'));

alter table public.evidence_files
  add column inbox_item_id  uuid references public.inbox_items (id),
  add column review_status  text not null default 'accepted'
    check (review_status in ('draft', 'pending', 'accepted', 'needs_more', 'rejected')),
  add column review_note    text,
  add column reviewed_by    uuid references auth.users (id),
  add column reviewed_at    timestamptz,
  add column phase          text check (phase in ('before', 'during', 'after')),
  add column job_item_id    uuid references public.job_items (id),
  add column checklist_key  text,          -- photo slot, e.g. before | after | label | product
  add column doc_type       text,
  add column lat            double precision,
  add column lng            double precision,
  add column accuracy_m     double precision,
  add column geo_source     text check (geo_source in ('browser', 'exif', 'none')),
  add column flags          text[] not null default '{}',
  add column received_from  text,
  add constraint evidence_files_placed check (work_order_id is not null or inbox_item_id is not null);

create index evidence_files_review_idx on public.evidence_files (review_status) where review_status <> 'accepted';
create index evidence_files_inbox_idx on public.evidence_files (inbox_item_id) where inbox_item_id is not null;

-- Landlords and agencies see a file only once it is accepted (plus not hidden or deleted,
-- as before). The field team sees only its own captures on jobs still assigned to it.
drop policy evidence_files_read on public.evidence_files;
create policy evidence_files_read on public.evidence_files for select to authenticated
  using (
    (select app.is_admin())
    or (review_status = 'accepted' and not hidden and deleted_at is null
        and app.can_see_work_order(work_order_id))
    or (uploaded_by = (select auth.uid()) and app.field_assigned(work_order_id))
  );

create or replace function app.can_see_evidence_file(p_file_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.evidence_files f
    where f.id = p_file_id
      and (app.is_admin() or (f.review_status = 'accepted' and not f.hidden and f.deleted_at is null
                              and app.can_see_work_order(f.work_order_id)))
  )
$$;

create or replace function app.can_read_evidence_object(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_admin() or exists (
    select 1 from public.evidence_files f
    where (f.storage_path = p_path or f.poster_path = p_path)
      and f.deleted_at is null
      and (
        (f.review_status = 'accepted' and not f.hidden and app.can_see_work_order(f.work_order_id))
        or (f.uploaded_by = auth.uid() and app.field_assigned(f.work_order_id))
      )
  )
$$;

-- The field team adds photos to its own jobs, as drafts, and nothing else.
create policy evidence_files_field_insert on public.evidence_files for insert to authenticated
  with check (
    app.field_assigned(work_order_id)
    and uploaded_by = (select auth.uid())
    and source = 'field_capture' and review_status = 'draft' and stage = 'works' and kind = 'photo'
    and inbox_item_id is null and not hidden and deleted_at is null and reviewed_by is null
    and storage_path like work_order_id || '/%'
  );

create policy evidence_objects_field_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'evidence' and app.field_assigned(split_part(name, '/', 1)));

-- Submit: the field team's drafts on a job go to Blain's review queue. After this they
-- can't change or remove them (spec 3A "Corrections").
create function public.submit_field_job(p_work_order_id text) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not app.field_assigned(p_work_order_id) then
    raise exception 'This job is not assigned to the field team.';
  end if;
  update public.evidence_files set review_status = 'pending'
  where work_order_id = p_work_order_id and uploaded_by = auth.uid()
    and review_status = 'draft' and deleted_at is null;
  get diagnostics n = row_count;
  insert into public.audit_log (actor, action, entity, entity_id, meta)
  values (auth.uid(), 'field.submit', 'work_orders', p_work_order_id, jsonb_build_object('files', n));
  return n;
end $$;

-- Remove a photo taken by mistake, only while it is still a draft.
create function public.discard_field_photo(p_file_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare wo text;
begin
  select work_order_id into wo from public.evidence_files
  where id = p_file_id and uploaded_by = auth.uid() and review_status = 'draft' and deleted_at is null;
  if wo is null or not app.field_assigned(wo) then return false; end if;
  update public.evidence_files set deleted_at = now(), delete_reason = 'Discarded by the field team before submitting'
  where id = p_file_id;
  insert into public.audit_log (actor, action, entity, entity_id) values (auth.uid(), 'field.discard', 'evidence_files', p_file_id::text);
  return true;
end $$;

-- An item with accepted evidence is locked for the field team (its label is part of the record).
create function app.job_item_locked(p_item_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.evidence_files f where f.job_item_id = p_item_id and f.review_status = 'accepted')
$$;

-- ---------------------------------------------------------------------------
-- Compliance status, written summaries, notes
-- ---------------------------------------------------------------------------

create table public.upgrade_status (
  id                bigint generated always as identity primary key,
  work_order_id     text not null,
  status            text not null check (status in ('not_assessed', 'not_yet_applicable', 'evidence_pending',
                                                    'evidenced_compliant', 'exempt_recorded', 'non_compliant')),
  exemption_ground  text,
  note              text,
  set_by            uuid references auth.users (id),
  set_at            timestamptz not null default now()
);
create index upgrade_status_wo_idx on public.upgrade_status (work_order_id, set_at desc);

create table public.written_summaries (
  id             uuid primary key default gen_random_uuid(),
  property_id    text not null,
  work_order_id  text,
  kind           text not null check (kind in ('works', 'completion')),
  version        int not null,
  body           text not null,
  status         text not null default 'draft' check (status in ('draft', 'published', 'superseded')),
  source         text not null default 'manual' check (source in ('manual')),
  written_by     uuid references auth.users (id),
  created_at     timestamptz not null default now(),
  published_by   uuid references auth.users (id),
  published_at   timestamptz,
  constraint written_summaries_scope check ((kind = 'works') = (work_order_id is not null))
);
create unique index written_summaries_version_idx
  on public.written_summaries (property_id, kind, coalesce(work_order_id, ''), version);
create unique index written_summaries_one_published_idx
  on public.written_summaries (property_id, kind, coalesce(work_order_id, '')) where status = 'published';

create table public.notes (
  id             uuid primary key default gen_random_uuid(),
  property_id    text not null,
  work_order_id  text,
  body           text not null,
  visibility     text not null default 'internal' check (visibility in ('internal', 'agency', 'agency_landlord')),
  author         uuid references auth.users (id),
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  delete_reason  text
);
create index notes_property_idx on public.notes (property_id);

-- ---------------------------------------------------------------------------
-- Grants and RLS
-- ---------------------------------------------------------------------------

grant execute on function app.field_assigned(text), app.job_item_locked(uuid) to authenticated;
revoke execute on function app.field_assigned(text), app.job_item_locked(uuid) from public, anon;
revoke execute on function public.field_jobs(), public.submit_field_job(text), public.discard_field_photo(uuid) from public, anon;
grant execute on function public.field_jobs(), public.submit_field_job(text), public.discard_field_photo(uuid) to authenticated;

revoke all on public.field_assignments, public.job_items, public.job_checklists, public.inbox_items,
  public.upgrade_status, public.written_summaries, public.notes from anon, authenticated;
grant select, insert, update on public.field_assignments, public.job_items, public.job_checklists,
  public.inbox_items, public.written_summaries, public.notes to authenticated;
grant select, insert on public.upgrade_status to authenticated;

alter table public.field_assignments  enable row level security;
alter table public.job_items          enable row level security;
alter table public.job_checklists     enable row level security;
alter table public.inbox_items        enable row level security;
alter table public.upgrade_status     enable row level security;
alter table public.written_summaries  enable row level security;
alter table public.notes              enable row level security;

create policy field_assignments_admin on public.field_assignments for all to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

create policy job_items_read on public.job_items for select to authenticated
  using ((select app.is_admin()) or app.field_assigned(work_order_id)
         or (removed_at is null and app.can_see_work_order(work_order_id)));
create policy job_items_insert on public.job_items for insert to authenticated
  with check ((select app.is_admin()) or (app.field_assigned(work_order_id) and created_by = (select auth.uid())));
create policy job_items_update on public.job_items for update to authenticated
  using ((select app.is_admin()) or (app.field_assigned(work_order_id) and not app.job_item_locked(id)))
  with check ((select app.is_admin()) or (app.field_assigned(work_order_id) and not app.job_item_locked(id)));

create policy job_checklists_read on public.job_checklists for select to authenticated
  using ((select app.is_admin()) or app.field_assigned(work_order_id));
create policy job_checklists_insert on public.job_checklists for insert to authenticated
  with check ((select app.is_admin()) or (app.field_assigned(work_order_id) and updated_by = (select auth.uid())));
create policy job_checklists_update on public.job_checklists for update to authenticated
  using ((select app.is_admin()) or app.field_assigned(work_order_id))
  with check ((select app.is_admin()) or (app.field_assigned(work_order_id) and updated_by = (select auth.uid())));

-- Inbox: admin only (the webhook writes with the service key).
create policy inbox_items_admin on public.inbox_items for all to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

create policy upgrade_status_read on public.upgrade_status for select to authenticated
  using ((select app.is_admin()) or app.can_see_work_order(work_order_id));
create policy upgrade_status_admin_insert on public.upgrade_status for insert to authenticated
  with check ((select app.is_admin()) and set_by = (select auth.uid()));

create policy written_summaries_read on public.written_summaries for select to authenticated
  using ((select app.is_admin())
         or (status = 'published' and case when work_order_id is null then app.can_see_property(property_id)
                                           else app.can_see_work_order(work_order_id) end));
create policy written_summaries_admin_insert on public.written_summaries for insert to authenticated
  with check ((select app.is_admin()) and written_by = (select auth.uid()));
create policy written_summaries_admin_update on public.written_summaries for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

create policy notes_read on public.notes for select to authenticated
  using ((select app.is_admin())
         or (deleted_at is null and app.can_see_property(property_id)
             and ((visibility = 'agency_landlord' and app.my_role() in ('agency_user', 'landlord'))
                  or (visibility = 'agency' and app.my_role() = 'agency_user'))));
create policy notes_admin_insert on public.notes for insert to authenticated
  with check ((select app.is_admin()) and author = (select auth.uid()));
create policy notes_admin_update on public.notes for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));
