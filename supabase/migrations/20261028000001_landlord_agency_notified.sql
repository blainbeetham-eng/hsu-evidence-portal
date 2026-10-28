-- Agency notification consent (HSU_Agency_Notification_Consent_Spec.md v0.1, 27 Oct 2026).
-- For agencies on the "Agency notification" consent model (Marshall White), the
-- landlord's Consent Status becomes "Agency Notified" instead of "Granted".
-- Landlord access follows the same gate as the pipeline: Granted or Agency Notified
-- allow it; Pending and Declined block it. A landlord who objects is set back to
-- Pending by the intake, which removes access automatically.

create or replace function app.landlord_can_see_property(p_property_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.contacts c
    join public.properties p on p.id = p_property_id and p.removed_at is null
    where c.id = app.my_contact_id()
      and c.removed_at is null
      and c.consent_status in ('Granted', 'Agency Notified')
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

-- Distinct upgrade types and pipeline stages for the work-order filters, so a
-- renamed Airtable option (e.g. "Consent Granted" -> "Cleared to Proceed") needs
-- no portal change. SECURITY INVOKER: each caller only sees values from rows RLS
-- already lets them read.
create function public.work_order_facets()
returns table (kind text, value text)
language sql stable security invoker set search_path = '' as $$
  select distinct 'activity_type', w.activity_type
  from public.work_orders w
  where w.removed_at is null and w.activity_type is not null
  union
  select distinct 'pipeline_status', w.pipeline_status
  from public.work_orders w
  where w.removed_at is null and w.pipeline_status is not null
$$;

revoke execute on function public.work_order_facets() from public, anon;
grant execute on function public.work_order_facets() to authenticated;
