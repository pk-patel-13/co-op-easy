-- =====================================================================
-- 01 TABLES: what Co-op stores.
-- Run the files in this folder in order: 01, 02, 03, 04, then seed.sql.
-- =====================================================================

-- Companies: suppliers and service firms. Locations live in "branches".
create table if not exists public.companies (
  id               text primary key,
  kind             text not null check (kind in ('materials', 'services')),
  name             text not null,
  category         text not null,
  description      text,
  email            text,
  website          text,
  contact          text,
  items            text[] not null default '{}',
  extra            text,
  serves           text,
  license          text,
  founded          text,
  image_url        text,
  image_is_photo   boolean not null default false,
  image_source     text,
  checked_on       date,

  -- a listing added by a contractor (not by Co-op) waits for admin approval
  listed_by        uuid references auth.users (id) on delete set null,
  approved         boolean not null default true,

  -- the contractor account that manages this company
  claimed_by       uuid references auth.users (id) on delete set null,
  claim_status     text not null default 'none' check (claim_status in ('none', 'pending', 'verified')),
  claim_note       text,             -- role + license number given when claiming (private)
  claimed_at       timestamptz,

  -- availability set by the verified contractor; shown for 24 hours
  status           text check (status in ('available', 'busy', 'closed')),
  status_note      text,
  status_at        timestamptz,

  created_at       timestamptz not null default now()
);

-- Branches: every yard, store or office of a company.
create table if not exists public.branches (
  id               text primary key,
  company_id       text not null references public.companies (id) on delete cascade,
  sort_order       int not null default 1,
  name             text not null default 'Main location',
  address          text,
  lat              double precision,
  lng              double precision,
  approx_location  boolean not null default false,
  phones           text[] not null default '{}',
  hours_text       text,
  schedule         jsonb,            -- {"1": [6.5, 16], ...}  day 0 = Sunday, Miami time
  always_open      boolean not null default false,
  contact          text,             -- e.g. the branch manager, as published by the company
  page             text              -- the web page where this branch was checked
);

-- Profiles: one per person, created automatically on sign-up (see 02_functions.sql).
create table if not exists public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  email          text,
  role           text not null check (role in ('client', 'contractor')),
  full_name      text not null,
  phone          text,
  client_type    text check (client_type in ('homeowner', 'business')),
  business_name  text,
  zip            text,
  company_id     text references public.companies (id) on delete set null,
  is_admin       boolean not null default false,
  created_at     timestamptz not null default now()
);

-- Requests from clients. company_id empty = sent to everyone in the category.
create table if not exists public.requests (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  company_id  text references public.companies (id) on delete cascade,
  kind        text not null check (kind in ('materials', 'services')),
  category    text not null,
  need        text not null check (char_length(need) between 3 and 120),
  details     text check (char_length(details) <= 1000),
  when_text   text check (char_length(when_text) <= 60),
  zip         text check (zip ~ '^[0-9]{5}$'),
  lat         double precision,
  lng         double precision,
  status      text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  created_at  timestamptz not null default now()
);

-- Replies from companies (one per company per request).
create table if not exists public.replies (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.requests (id) on delete cascade,
  company_id  text not null references public.companies (id) on delete cascade,
  author_id   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  message     text not null check (char_length(message) between 1 and 1000),
  price       text check (char_length(price) <= 80),
  eta         text check (char_length(eta) <= 80),
  created_at  timestamptz not null default now(),
  unique (request_id, company_id)
);

-- Reviews: one per request, by the client, for a company that replied.
create table if not exists public.reviews (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null unique references public.requests (id) on delete cascade,
  client_id   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  company_id  text not null references public.companies (id) on delete cascade,
  stars       int not null check (stars between 1 and 5),
  body        text check (char_length(body) <= 600),
  created_at  timestamptz not null default now()
);

create index if not exists branches_company_idx  on public.branches (company_id);
create index if not exists requests_client_idx   on public.requests (client_id);
create index if not exists requests_company_idx  on public.requests (company_id);
create index if not exists requests_open_idx     on public.requests (kind, category) where status = 'open';
create index if not exists replies_request_idx   on public.replies (request_id);
create index if not exists replies_company_idx   on public.replies (company_id);
create index if not exists reviews_company_idx   on public.reviews (company_id);
