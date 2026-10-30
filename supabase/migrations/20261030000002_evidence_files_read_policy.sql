-- Fix: evidence_files' read policy looked the row up by id through a function. When the
-- admin inserts a file and asks for the new id back (INSERT ... RETURNING, which is what
-- the app does), that lookup runs before the new row is visible, so the read check failed
-- and the insert was refused. Check the row's own columns instead; same rule as before.
--
-- Rollback: recreate the policy as in 20261030000001.

drop policy evidence_files_read on public.evidence_files;

create policy evidence_files_read on public.evidence_files for select to authenticated
  using (
    (select app.is_admin())
    or (not hidden and deleted_at is null and app.can_see_work_order(work_order_id))
  );
