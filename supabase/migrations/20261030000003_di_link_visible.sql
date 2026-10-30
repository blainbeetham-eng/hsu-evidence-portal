-- The DI online-report link is printed in the report PDF anyway, so landlords and
-- agencies may see it alongside the report (Blain, 30 Oct 2026). Readable by whoever
-- can see the report; still only admin writes it.
--
-- Rollback: drop report_extras_read and recreate report_extras_admin "for all".

drop policy report_extras_admin on public.report_extras;

create policy report_extras_read on public.report_extras for select to authenticated
  using (app.can_see_evidence_file(report_id));
create policy report_extras_admin_insert on public.report_extras for insert to authenticated
  with check ((select app.is_admin()));
create policy report_extras_admin_update on public.report_extras for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));
