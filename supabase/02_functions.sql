-- =====================================================================
-- 02 FUNCTIONS: the only ways to change companies, plus sign-up setup.
-- They run with the owner's rights ("security definer"), so each one
-- checks who is calling before doing anything.
-- =====================================================================

-- ---------- helpers used by the security rules ----------

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false);
$$;

-- The company this person manages, once verified.
create or replace function public.my_company() returns text
language sql stable security definer set search_path = public as $$
  select id from companies where claimed_by = auth.uid() and claim_status = 'verified' limit 1;
$$;

-- Can the signed-in contractor see a request with these fields?
create or replace function public.contractor_sees(p_company text, p_kind text, p_category text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from companies c
    where c.claimed_by = auth.uid()
      and c.claim_status = 'verified'
      and (c.id = p_company or (p_company is null and c.kind = p_kind and c.category = p_category))
  );
$$;

-- ---------- sign-up: create the profile from the sign-up form ----------

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into profiles (id, email, role, full_name, phone, client_type, business_name, zip)
  values (
    new.id,
    new.email,
    case when meta ->> 'role' = 'contractor' then 'contractor' else 'client' end,
    left(coalesce(nullif(trim(meta ->> 'full_name'), ''), split_part(new.email, '@', 1)), 80),
    left(nullif(trim(meta ->> 'phone'), ''), 30),
    case when meta ->> 'role' = 'contractor' then null
         when meta ->> 'client_type' = 'business' then 'business'
         else 'homeowner' end,
    left(nullif(trim(meta ->> 'business_name'), ''), 120),
    case when meta ->> 'zip' ~ '^[0-9]{5}$' then meta ->> 'zip' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- contractor actions ----------

-- The website's domain, e.g. 'https://www.delsolroofing.com/about' -> 'delsolroofing.com'
create or replace function public.site_domain(p_url text) returns text
language sql immutable as $$
  select lower(regexp_replace(regexp_replace(coalesce(p_url, ''), '^https?://(www\.)?', ''), '[/:?#].*$', ''));
$$;

-- Claim a listed company. Verified at once when the account's confirmed email is on
-- the company's website domain (info@delsolroofing.com for delsolroofing.com).
-- Otherwise it waits for an admin. Returns 'verified' or 'pending'.
create or replace function public.claim_company(p_company text, p_note text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_email     text;
  v_confirmed timestamptz;
  v_site      text;
  v_owner     uuid;
  v_status    text;
begin
  if (select role from profiles where id = auth.uid()) is distinct from 'contractor' then
    raise exception 'Only contractor accounts can claim a company.';
  end if;
  if exists (select 1 from companies where claimed_by = auth.uid()) then
    raise exception 'Your account already manages a company.';
  end if;

  select website, claimed_by into v_site, v_owner from companies where id = p_company and approved for update;
  if not found then raise exception 'Company not found.'; end if;
  if v_owner is not null then
    raise exception 'Someone has already claimed this company. Contact Co-op if that is wrong.';
  end if;

  select email, email_confirmed_at into v_email, v_confirmed from auth.users where id = auth.uid();
  v_status := case
    when v_confirmed is not null and site_domain(v_site) <> '' and lower(split_part(v_email, '@', 2)) = site_domain(v_site)
      then 'verified'
    else 'pending'
  end;

  update companies set claimed_by = auth.uid(), claim_status = v_status, claim_note = left(p_note, 300), claimed_at = now()
   where id = p_company;
  update profiles set company_id = p_company where id = auth.uid();
  return v_status;
end;
$$;

-- Add a company that isn't in the directory yet. Waits for admin approval.
create or replace function public.submit_company(
  p_kind text, p_name text, p_category text, p_address text, p_phone text,
  p_website text, p_description text, p_note text
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_id text;
begin
  if (select role from profiles where id = auth.uid()) is distinct from 'contractor' then
    raise exception 'Only contractor accounts can add a company.';
  end if;
  if exists (select 1 from companies where claimed_by = auth.uid()) then
    raise exception 'Your account already manages a company.';
  end if;
  if p_kind not in ('materials', 'services') or coalesce(trim(p_name), '') = '' or coalesce(trim(p_category), '') = '' then
    raise exception 'Company name, type and category are required.';
  end if;

  v_id := trim(both '-' from regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g')) || '-' || substr(md5(random()::text), 1, 5);
  insert into companies (id, kind, name, category, website, description,
                         listed_by, approved, claimed_by, claim_status, claim_note, claimed_at)
  values (v_id, p_kind, left(trim(p_name), 120), left(trim(p_category), 60), left(p_website, 200), left(p_description, 600),
          auth.uid(), false, auth.uid(), 'pending', left(p_note, 300), now());
  insert into branches (id, company_id, name, address, phones)
  values (v_id || '-1', v_id, 'Main location', left(p_address, 200),
          case when coalesce(trim(p_phone), '') = '' then '{}'::text[] else array[left(trim(p_phone), 30)] end);
  update profiles set company_id = v_id where id = auth.uid();
  return v_id;
end;
$$;

-- Available / Busy / Closed today, shown to clients for 24 hours.
create or replace function public.set_company_status(p_status text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('available', 'busy', 'closed') then raise exception 'Unknown status.'; end if;
  update companies set status = p_status, status_note = left(p_note, 140), status_at = now()
   where claimed_by = auth.uid() and claim_status = 'verified';
  if not found then raise exception 'Your company is not verified yet.'; end if;
end;
$$;

-- Edit your verified company's public details. (Branch addresses and hours: ask an admin.)
create or replace function public.update_my_company(
  p_description text, p_email text, p_contact text, p_items text[], p_serves text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  update companies
     set description = left(p_description, 600),
         email       = left(p_email, 120),
         contact     = left(p_contact, 200),
         items       = coalesce(p_items[1:30], '{}'),
         serves      = left(p_serves, 200)
   where claimed_by = auth.uid() and claim_status = 'verified';
  if not found then raise exception 'Your company is not verified yet.'; end if;
end;
$$;

-- Give up a claim (e.g. picked the wrong company). A pending new listing is removed.
create or replace function public.release_claim() returns void
language plpgsql security definer set search_path = public as $$
begin
  update profiles set company_id = null where id = auth.uid();
  delete from companies where claimed_by = auth.uid() and not approved;
  update companies set claimed_by = null, claim_status = 'none', claim_note = null, claimed_at = null
   where claimed_by = auth.uid();
end;
$$;

-- ---------- admin actions ----------

create or replace function public.admin_decide_claim(p_company text, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  select claimed_by into v_owner from companies where id = p_company;
  if not found then raise exception 'Company not found.'; end if;
  if p_approve then
    update companies set claim_status = 'verified', approved = true where id = p_company;
  else
    update profiles set company_id = null where id = v_owner;
    delete from companies where id = p_company and not approved;
    update companies set claimed_by = null, claim_status = 'none', claim_note = null, claimed_at = null
     where id = p_company;
  end if;
end;
$$;

-- Who is behind each pending claim. Admins only.
create or replace function public.admin_pending_claims()
returns table (company_id text, company_name text, website text, is_new_listing boolean,
               claim_note text, claimed_at timestamptz, full_name text, email text, phone text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  return query
    select c.id, c.name, c.website, not c.approved, c.claim_note, c.claimed_at, p.full_name, p.email, p.phone
    from companies c join profiles p on p.id = c.claimed_by
    where c.claim_status = 'pending'
    order by c.claimed_at;
end;
$$;
