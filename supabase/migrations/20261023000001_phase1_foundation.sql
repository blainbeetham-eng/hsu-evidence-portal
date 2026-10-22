-- Phase 1 foundation: read-only mirror of Airtable, profiles, sync log, audit log,
-- and Row Level Security for all four roles (admin, agency_user, landlord, installer).
--
-- Rules (HSU_Evidence_Portal_Spec.md v0.3):
--   * Airtable is the system of record. Mirror tables use the Airtable record ID as
--     their primary key and are written only by the sync (service role, bypasses RLS).
--   * No supplier cost, margin or quote amounts exist anywhere in this schema.
--   * Signed-in users can only read. Nothing here is writable by the anon or
--     authenticated roles.
--   * admin and agency_user must have completed MFA (aal2) to read anything.

create schema if not exists app;

create type public.app_role as enum ('admin', 'agency_user', 'landlord', 'installer');

-- ---------------------------------------------------------------------------
-- Mirror tables (Airtable -> portal). removed_at is set when a record disappears
-- from Airtable and cleared if it comes back.
-- ---------------------------------------------------------------------------

create table public.agencies (
  id          text primary key,              -- Airtable Agencies record ID
  name        text not null,
  synced_at   timestamptz not null default now(),
  removed_at  timestamptz
);

create table public.supplier_orgs (
  id          text primary key,              -- Airtable Supplier record ID
  name        text not null,
  email       text,
  synced_at   timestamptz not null default now(),
  removed_at  timestamptz
);

create table public.contacts (
  id              text primary key,          -- Airtable Contacts record ID
  name            text,
  email           text,
  role            text,                      -- Landlord | Tenant | Property Manager
  consent_status  text,                      -- Granted | Declined | Pending
  agency_ids      text[] not null default '{}',
  synced_at       timestamptz not null default now(),
  removed_at      timestamptz
);

create table public.properties (
  id                           text primary key,  -- Airtable Properties record ID
  address                      text not null,
  property_type                text,
  agency_id                    text,
  current_landlord_ids         text[] not null default '{}',
  lease_renewal_date           date,              -- mirrored from Airtable
  lease_renewal_date_override  date,              -- portal-only admin override (Phase 2 UI)
  synced_at                    timestamptz not null default now(),
  removed_at                   timestamptz
);

create table public.work_orders (
  id                text primary key,        -- Airtable Work Orders record ID
  property_id       text,
  activity_type     text,
  pipeline_status   text,
  source_order_ref  text,
  landlord_ids      text[] not null default '{}',
  supplier_ids      text[] not null default '{}',
  ai_job_summary    text,
  is_test           boolean not null default false,
  synced_at         timestamptz not null default now(),
  removed_at        timestamptz
);

create index properties_agency_id_idx on public.properties (agency_id);
create index properties_current_landlord_ids_idx on public.properties using gin (current_landlord_ids);
create index work_orders_property_id_idx on public.work_orders (property_id);
create index work_orders_landlord_ids_idx on public.work_orders using gin (landlord_ids);

-- ---------------------------------------------------------------------------
-- Portal-owned tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  role             public.app_role not null,
  full_name        text,
  agency_id        text,      -- agency_user
  contact_id       text,      -- landlord (Airtable Contacts record ID)
  supplier_org_id  text,      -- installer (Airtable Supplier record ID)
  created_at       timestamptz not null default now(),
  constraint profiles_role_link check (
    (role = 'admin') or
    (role = 'agency_user' and agency_id is not null) or
    (role = 'landlord'    and contact_id is not null) or
    (role = 'installer'   and supplier_org_id is not null)
  )
);

create table public.work_order_assignments (
  id               bigint generated always as identity primary key,
  work_order_id    text not null,
  supplier_org_id  text not null,
  source           text not null check (source in ('admin', 'airtable_mirror')),
  assigned_by      uuid references auth.users (id),
  assigned_at      timestamptz not null default now(),
  ended_at         timestamptz
);

create index work_order_assignments_wo_idx on public.work_order_assignments (work_order_id);
create index work_order_assignments_org_idx on public.work_order_assignments (supplier_org_id);

create table public.sync_runs (
  id                 bigint generated always as identity primary key,
  trigger            text not null check (trigger in ('cron', 'manual', 'test')),
  triggered_by       uuid references auth.users (id),
  status             text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  counts             jsonb not null default '{}',
  unexpected_fields  text[] not null default '{}',
  error              text
);

create table public.audit_log (
  id         bigint generated always as identity primary key,
  actor      uuid references auth.users (id),
  action     text not null,
  entity     text,
  entity_id  text,
  at         timestamptz not null default now(),
  meta       jsonb not null default '{}'
);

-- ---------------------------------------------------------------------------
-- Helper functions. SECURITY DEFINER so policies can read profiles/properties
-- without recursing through RLS. The app schema is not exposed by the API.
-- ---------------------------------------------------------------------------

create function app.my_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid()
$$;

create function app.mfa_ok() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

create function app.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.my_role() = 'admin' and app.mfa_ok()
$$;

create function app.my_agency_id() returns text
language sql stable security definer set search_path = '' as $$
  select agency_id from public.profiles where id = auth.uid() and role = 'agency_user'
$$;

create function app.my_contact_id() returns text
language sql stable security definer set search_path = '' as $$
  select contact_id from public.profiles where id = auth.uid() and role = 'landlord'
$$;

create function app.my_supplier_org_id() returns text
language sql stable security definer set search_path = '' as $$
  select supplier_org_id from public.profiles where id = auth.uid() and role = 'installer'
$$;

-- Landlord access: the property's Current Landlord if it has one, otherwise the
-- Landlord on that property's work orders. Only while Consent Status = Granted.
create function app.landlord_can_see_property(p_property_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.contacts c
    join public.properties p on p.id = p_property_id and p.removed_at is null
    where c.id = app.my_contact_id()
      and c.removed_at is null
      and c.consent_status = 'Granted'
      and (
        case
          when cardinality(p.current_landlord_ids) > 0
            then c.id = any (p.current_landlord_ids)
          else exists (
            select 1 from public.work_orders w
            where w.property_id = p.id
              and w.removed_at is null
              and c.id = any (w.landlord_ids)
          )
        end
      )
  )
$$;

create function app.installer_assigned_to_work_order(p_work_order_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.work_order_assignments a
    where a.work_order_id = p_work_order_id
      and a.supplier_org_id = app.my_supplier_org_id()
      and a.ended_at is null
  )
$$;

create function app.can_see_property(p_property_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case app.my_role()
    when 'admin' then app.mfa_ok()
    when 'agency_user' then app.mfa_ok() and exists (
      select 1 from public.properties p
      where p.id = p_property_id and p.removed_at is null
        and p.agency_id = app.my_agency_id()
    )
    when 'landlord' then app.landlord_can_see_property(p_property_id)
    when 'installer' then exists (
      select 1 from public.work_orders w
      where w.property_id = p_property_id and w.removed_at is null
        and app.installer_assigned_to_work_order(w.id)
    )
    else false
  end
$$;

create function app.can_see_work_order(p_work_order_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case app.my_role()
    when 'admin' then app.mfa_ok()
    when 'installer' then app.installer_assigned_to_work_order(p_work_order_id)
    else exists (
      select 1 from public.work_orders w
      where w.id = p_work_order_id and w.removed_at is null
        and app.can_see_property(w.property_id)
    )
  end
$$;

-- ---------------------------------------------------------------------------
-- Grants. Signed-in users read through RLS; anon gets nothing.
-- ---------------------------------------------------------------------------

grant usage on schema app to authenticated;
grant execute on all functions in schema app to authenticated;
revoke execute on all functions in schema app from public, anon;

revoke all on public.agencies, public.supplier_orgs, public.contacts, public.properties,
  public.work_orders, public.profiles, public.work_order_assignments, public.sync_runs,
  public.audit_log from anon, authenticated;

grant select on public.agencies, public.supplier_orgs, public.contacts, public.properties,
  public.work_orders, public.profiles, public.work_order_assignments, public.sync_runs,
  public.audit_log to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.agencies               enable row level security;
alter table public.supplier_orgs          enable row level security;
alter table public.contacts               enable row level security;
alter table public.properties             enable row level security;
alter table public.work_orders            enable row level security;
alter table public.profiles               enable row level security;
alter table public.work_order_assignments enable row level security;
alter table public.sync_runs              enable row level security;
alter table public.audit_log              enable row level security;

create policy agencies_read on public.agencies for select to authenticated
  using ((select app.is_admin()) or (app.mfa_ok() and id = (select app.my_agency_id())));

create policy supplier_orgs_read on public.supplier_orgs for select to authenticated
  using ((select app.is_admin()) or id = (select app.my_supplier_org_id()));

-- Contact details (landlord name, email) are admin-only.
create policy contacts_read on public.contacts for select to authenticated
  using ((select app.is_admin()));

create policy properties_read on public.properties for select to authenticated
  using (app.can_see_property(id));

create policy work_orders_read on public.work_orders for select to authenticated
  using (app.can_see_work_order(id));

create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select app.is_admin()));

create policy work_order_assignments_read on public.work_order_assignments for select to authenticated
  using ((select app.is_admin()) or supplier_org_id = (select app.my_supplier_org_id()));

create policy sync_runs_read on public.sync_runs for select to authenticated
  using ((select app.is_admin()));

create policy audit_log_read on public.audit_log for select to authenticated
  using ((select app.is_admin()));
