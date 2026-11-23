-- Quote visit (site measure before quoting), admin only. 23 Nov 2026.
-- Job-level answers for each upgrade's quote visit (e.g. ceiling area, switchboard).
-- Per-door/window/shower measurements are job_items.details keys starting "q_", and
-- photos are evidence_files at stage 'assessment', checklist_key 'quote', hidden from
-- landlords and agencies until Blain shows them. See src/lib/quote-visit.ts.

create table public.quote_visits (
  work_order_id     text primary key,
  template          text not null,
  template_version  text not null,
  answers           jsonb not null default '{}',
  updated_by        uuid references auth.users (id),
  updated_at        timestamptz not null default now()
);

revoke all on public.quote_visits from anon, authenticated;
grant select, insert, update on public.quote_visits to authenticated;
alter table public.quote_visits enable row level security;

create policy quote_visits_admin on public.quote_visits for all to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));
