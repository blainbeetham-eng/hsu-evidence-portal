-- Phase 2B (spec v0.8 item 6): HSU's own draughtproofing and showerhead team signs in
-- on their phones. Kept in its own migration because Postgres won't let a new enum
-- value be used in the same transaction that adds it.
--
-- Rollback: enum values can't be dropped; remove any field_team profiles first and
-- leave the value unused.

alter type public.app_role add value if not exists 'field_team';
