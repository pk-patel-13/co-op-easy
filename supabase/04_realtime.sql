-- =====================================================================
-- 04 REALTIME: let the browser hear about new requests, replies and
-- status changes as they happen. Security rules still apply to what
-- each person receives.
-- =====================================================================

do $$
begin
  alter publication supabase_realtime add table public.requests, public.replies, public.companies;
exception when duplicate_object then null;
end $$;
