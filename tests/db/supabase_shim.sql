-- A tiny stand-in for what Supabase provides, so the schema can be tested on plain Postgres.
-- Not used in production: Supabase already has all of this.

do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;

grant usage on schema public to anon, authenticated;
-- Supabase grants these by default on new tables and functions; our security file revokes what it doesn't want.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;

create schema if not exists auth;
create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text,
  email_confirmed_at  timestamptz,
  raw_user_meta_data  jsonb
);

-- Supabase's auth.uid(): the signed-in user's id from the request's login token.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

do $$ begin create publication supabase_realtime; exception when duplicate_object then null; end $$;
