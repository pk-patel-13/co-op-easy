-- =====================================================================
-- 03 SECURITY: who can read and write what (Row Level Security).
--
--   Anyone, even signed out : the directory, branches, ratings, reviews.
--   Clients                 : their own profile and requests, and replies to them.
--   Verified contractors    : requests for their company or their category, and the
--                             name/phone/email of the clients who sent them.
--   Admins                  : everything, and they approve company claims.
-- =====================================================================

-- Public numbers used for sorting: reply speed and ratings.
-- Runs with owner rights on purpose: it only exposes totals, never rows.
create or replace view public.company_stats as
select
  c.id as company_id,
  (select percentile_cont(0.5) within group (order by (extract(epoch from (p.created_at - r.created_at)) / 60)::float8)
     from replies p join requests r on r.id = p.request_id
    where p.company_id = c.id)                                                   as median_reply_minutes,
  (select count(*) from replies p where p.company_id = c.id)                     as reply_count,
  (select round(avg(stars)::numeric, 2) from reviews v where v.company_id = c.id) as avg_stars,
  (select count(*) from reviews v where v.company_id = c.id)                     as review_count
from companies c
where c.approved;

alter table public.companies enable row level security;
alter table public.branches  enable row level security;
alter table public.profiles  enable row level security;
alter table public.requests  enable row level security;
alter table public.replies   enable row level security;
alter table public.reviews   enable row level security;

-- ---------- table permissions: start from nothing, grant what the app needs ----------

revoke all on public.companies, public.branches, public.profiles, public.requests, public.replies, public.reviews
  from anon, authenticated;
revoke all on public.company_stats from anon, authenticated;

-- every company column except claim_note (a claimant's role and license number stay private)
grant select (id, kind, name, category, description, email, website, contact, items, extra, serves, license, founded,
              image_url, image_is_photo, image_source, checked_on, listed_by, approved, claimed_by, claim_status,
              claimed_at, status, status_note, status_at, created_at)
  on public.companies to anon, authenticated;
grant select on public.branches      to anon, authenticated;
grant select on public.company_stats to anon, authenticated;
-- reviews are public, but not who wrote them
grant select (id, request_id, company_id, stars, body, created_at) on public.reviews to anon, authenticated;
grant select on public.profiles      to authenticated;
grant update (full_name, phone, client_type, business_name, zip) on public.profiles to authenticated;
grant select, insert on public.requests to authenticated;
grant update (status) on public.requests to authenticated;
grant select, insert on public.replies to authenticated;
grant insert on public.reviews to authenticated;

revoke execute on all functions in schema public from anon, authenticated, public;
grant execute on function public.is_admin(), public.my_company(), public.contractor_sees(text, text, text),
                          public.site_domain(text)                             to anon, authenticated;
grant execute on function public.claim_company(text, text)                     to authenticated;
grant execute on function public.submit_company(text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.set_company_status(text, text)                to authenticated;
grant execute on function public.update_my_company(text, text, text, text[], text) to authenticated;
grant execute on function public.release_claim()                               to authenticated;
grant execute on function public.admin_decide_claim(text, boolean)             to authenticated;
grant execute on function public.admin_pending_claims()                        to authenticated;

-- ---------- companies and branches ----------

drop policy if exists "directory is public" on public.companies;
create policy "directory is public" on public.companies
  for select using (approved or listed_by = auth.uid() or public.is_admin());

drop policy if exists "branches of visible companies" on public.branches;
create policy "branches of visible companies" on public.branches
  for select using (exists (select 1 from public.companies c where c.id = company_id));

-- ---------- profiles ----------

drop policy if exists "see own profile" on public.profiles;
create policy "see own profile" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

drop policy if exists "contractors see their clients" on public.profiles;
create policy "contractors see their clients" on public.profiles
  for select using (
    exists (
      select 1 from public.requests r
      where r.client_id = profiles.id
        and public.contractor_sees(r.company_id, r.kind, r.category)
    )
  );

drop policy if exists "edit own profile" on public.profiles;
create policy "edit own profile" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- ---------- requests ----------

drop policy if exists "see requests" on public.requests;
create policy "see requests" on public.requests
  for select using (
    client_id = auth.uid()
    or public.contractor_sees(company_id, kind, category)
    or public.is_admin()
  );

drop policy if exists "send requests" on public.requests;
create policy "send requests" on public.requests
  for insert with check (client_id = auth.uid() and status = 'open');

drop policy if exists "update own requests" on public.requests;
create policy "update own requests" on public.requests
  for update using (client_id = auth.uid()) with check (client_id = auth.uid());

-- ---------- replies ----------

drop policy if exists "see replies" on public.replies;
create policy "see replies" on public.replies
  for select using (
    company_id = public.my_company()
    or exists (select 1 from public.requests r where r.id = request_id and r.client_id = auth.uid())
    or public.is_admin()
  );

drop policy if exists "verified contractors reply" on public.replies;
create policy "verified contractors reply" on public.replies
  for insert with check (
    author_id = auth.uid()
    and company_id = public.my_company()
    and exists (select 1 from public.requests r where r.id = request_id and r.status = 'open')
  );

-- ---------- reviews ----------

drop policy if exists "reviews are public" on public.reviews;
create policy "reviews are public" on public.reviews
  for select using (true);

drop policy if exists "clients review companies that replied" on public.reviews;
create policy "clients review companies that replied" on public.reviews
  for insert with check (
    client_id = auth.uid()
    and exists (select 1 from public.requests r where r.id = request_id and r.client_id = auth.uid())
    and exists (select 1 from public.replies p where p.request_id = reviews.request_id and p.company_id = reviews.company_id)
  );
