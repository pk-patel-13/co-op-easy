"""Database tests: runs supabase/*.sql on a real PostgreSQL and checks every security rule
and function by acting as different people (signed out, clients, contractors, admin).

    pip install pgserver "psycopg[binary]"
    python tests/db/test_database.py

Uses a throwaway local Postgres (pgserver). Set DATABASE_URL to use your own instead.
"""
import os
import sys
import uuid
from contextlib import contextmanager
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parents[2]
SQL_FILES = ["01_tables.sql", "02_functions.sql", "03_security.sql", "04_realtime.sql", "seed.sql"]

results = []


def check(name, condition, detail=""):
    results.append((name, bool(condition), detail))
    print(("PASS " if condition else "FAIL ") + name + (f"  ({detail})" if detail and not condition else ""))


# ---------------------------------------------------------------- setup

def fresh_database():
    url = os.environ.get("DATABASE_URL")
    if not url:
        import pgserver
        server = pgserver.get_server(Path(os.environ.get("TEMP", "/tmp")) / "coop-pgtest", cleanup_mode="stop")
        url = server.get_uri()
    admin = psycopg.connect(url, autocommit=True)
    admin.execute("drop database if exists coop_test")
    admin.execute("create database coop_test")
    admin.close()
    return url.rsplit("/", 1)[0] + "/coop_test" if "?" not in url else url.replace("/postgres?", "/coop_test?")


def run_file(conn, path):
    conn.execute(Path(path).read_text(encoding="utf-8"))


DB_URL = fresh_database()
db = psycopg.connect(DB_URL, autocommit=True)   # the owner (like Supabase's dashboard SQL editor)
run_file(db, ROOT / "tests" / "db" / "supabase_shim.sql")
for f in SQL_FILES:
    run_file(db, ROOT / "supabase" / f)
check("all SQL files run on a clean database", True)


def make_user(email, meta, confirmed=True):
    uid = uuid.uuid4()
    db.execute("insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values (%s, %s, %s, %s)",
               (uid, email, "now()" if confirmed else None, psycopg.types.json.Jsonb(meta)))
    return str(uid)


@contextmanager
def acting_as(uid=None):
    """Run queries as a signed-in user (uid) or signed out (None), the way Supabase does."""
    conn = psycopg.connect(DB_URL)
    try:
        conn.execute("set role " + ("authenticated" if uid else "anon"))
        if uid:
            conn.execute("select set_config('request.jwt.claim.sub', %s, false)", (uid,))
        yield conn
        conn.commit()
    finally:
        conn.close()


def attempt(uid, sql, params=()):
    """Run one statement as someone. Returns (ok, rows or error text)."""
    try:
        with acting_as(uid) as conn:
            cur = conn.execute(sql, params)
            rows = cur.fetchall() if cur.description else cur.rowcount
            return True, rows
    except psycopg.Error as e:
        return False, str(e).split("\n")[0]


def one(uid, sql, params=()):
    ok, rows = attempt(uid, sql, params)
    assert ok, rows
    return rows[0][0] if rows else None


# ---------------------------------------------------------------- people

homeowner = make_user("ana@example.com", {"role": "client", "full_name": "Ana Lopez", "phone": "305-555-0101",
                                          "zip": "33130", "client_type": "homeowner", "is_admin": True})
firm = make_user("ben@buildco.com", {"role": "client", "full_name": "Ben Ortiz", "phone": "305-555-0102",
                                     "zip": "33142", "client_type": "business", "business_name": "BuildCo"})
roofer = make_user("info@delsolroofing.com", {"role": "contractor", "full_name": "Carla Diaz", "phone": "305-555-0103", "zip": "33126"})
roofer2 = make_user("dan.roofs@gmail.com", {"role": "contractor", "full_name": "Dan Ruiz", "phone": "305-555-0104", "zip": "33133"})
unconfirmed = make_user("eva@miamiproconstruction.com", {"role": "contractor", "full_name": "Eva Mora"}, confirmed=False)
admin = make_user("owner@co-op.example", {"role": "client", "full_name": "Site Owner"})
newco = make_user("gus@gusbuilds.com", {"role": "contractor", "full_name": "Gus Pena", "phone": "305-555-0107"})
db.execute("update public.profiles set is_admin = true where id = %s", (admin,))

# ---------------------------------------------------------------- 1. public directory

check("signed-out visitors see 23 companies", one(None, "select count(*) from companies") == 23)
check("signed-out visitors see 28 branches", one(None, "select count(*) from branches") == 28)
check("SRS has 3 branches", one(None, "select count(*) from branches where company_id = 'srs-building-products'") == 3)
ok, err = attempt(None, "select claim_note from companies")
check("claim notes are private", not ok and "permission denied" in err, err)
ok, err = attempt(None, "select * from profiles")
check("signed-out visitors can't read profiles", not ok, err)
check("ratings view is public", attempt(None, "select * from company_stats")[0])
ok, err = attempt(None, "update companies set name = 'x' where id = 'cemex'")
check("nobody can edit companies directly", not ok, err)
ok, err = attempt(homeowner, "insert into branches (id, company_id) values ('x', 'cemex')")
check("nobody can add branches directly", not ok, err)

# ---------------------------------------------------------------- 2. sign-up creates the right profile

row = one(homeowner, "select row(role, full_name, phone, zip, client_type, is_admin)::text from profiles where id = auth.uid()")
check("homeowner profile saved from sign-up form", row == "(client,\"Ana Lopez\",305-555-0101,33130,homeowner,f)", row)
check("sign-up can't make someone admin", "f)" in row)
row = one(firm, "select row(client_type, business_name)::text from profiles where id = auth.uid()")
check("business client profile saved", row == "(business,BuildCo)", row)
check("contractor profile has no client type", one(roofer, "select client_type from profiles where id = auth.uid()") is None)
ok, err = attempt(homeowner, "update profiles set is_admin = true where id = auth.uid()")
check("people can't make themselves admin", not ok, err)
check("people can update their phone", attempt(homeowner, "update profiles set phone = '305-555-0199' where id = auth.uid()")[1] == 1)
check("people can't edit someone else's profile", attempt(homeowner, "update profiles set full_name = 'x' where id = %s", (firm,))[1] == 0)
check("people see only their own profile", one(homeowner, "select count(*) from profiles") == 1)

# ---------------------------------------------------------------- 3. claiming companies

check("work email on the company's domain is verified instantly",
      one(roofer, "select claim_company('del-sol-roofing', 'Owner · License CCC1328657')") == "verified")
check("other emails wait for review", one(roofer2, "select claim_company('miami-roof-tech', 'Manager')") == "pending")
check("unconfirmed emails wait for review, even on the right domain",
      one(unconfirmed, "select claim_company('miami-pro-construction', 'Office')") == "pending")
ok, err = attempt(newco, "select claim_company('del-sol-roofing', 'x')")
check("an already-claimed company can't be claimed again", not ok and "already claimed" in err, err)
ok, err = attempt(homeowner, "select claim_company('cemex', 'x')")
check("clients can't claim companies", not ok and "contractor" in err, err)
ok, err = attempt(roofer, "select claim_company('cemex', 'x')")
check("one company per contractor account", not ok and "already manages" in err, err)
check("signed-out visitors don't see claim notes via the public view",
      one(None, "select claim_status from companies where id = 'del-sol-roofing'") == "verified")

# ---------------------------------------------------------------- 4. requests

ok, _ = attempt(homeowner, "insert into requests (company_id, kind, category, need, zip) values ('del-sol-roofing', 'services', 'Roofing Contractor', 'Fix a leak over the kitchen', '33130')")
check("client sends a request to one company", ok)
ok, _ = attempt(homeowner, "insert into requests (kind, category, need, zip) values ('services', 'Roofing Contractor', 'Re-roof quote, 2,000 sq ft tile', '33130')")
check("client sends a request to a whole category", ok)
ok, _ = attempt(firm, "insert into requests (company_id, kind, category, need, zip) values ('miami-pro-construction', 'services', 'General Contractor', 'Office build-out', '33142')")
check("business client sends a request", ok)
ok, err = attempt(homeowner, "insert into requests (client_id, kind, category, need) values (%s, 'services', 'x', 'pretend to be Ben')", (firm,))
check("nobody can send a request as someone else", not ok, err)
ok, err = attempt(homeowner, "insert into requests (kind, category, need, status) values ('services', 'x', 'already done', 'done')")
check("new requests must be open", not ok, err)
ok, err = attempt(homeowner, "insert into requests (kind, category, need, zip) values ('services', 'x', 'bad zip', '12')")
check("ZIP codes must be 5 digits", not ok, err)
ok, err = attempt(homeowner, "insert into requests (kind, category, need) values ('services', 'x', 'no')")
check("the need must be at least 3 characters", not ok, err)
ok, err = attempt(None, "insert into requests (kind, category, need) values ('services', 'x', 'anonymous')")
check("signed-out visitors can't send requests", not ok, err)

check("the verified roofer sees both roofing requests", one(roofer, "select count(*) from requests") == 2)
check("the roofer doesn't see the general contractor request",
      one(roofer, "select count(*) from requests where category = 'General Contractor'") == 0)
check("the roofer sees the client's contact details",
      one(roofer, "select full_name || ' ' || phone || ' ' || email from profiles where id = %s", (homeowner,))
      == "Ana Lopez 305-555-0199 ana@example.com")
check("the roofer can't see other clients", one(roofer, "select count(*) from profiles where id = %s", (firm,)) == 0)
check("a pending roofer sees no requests", one(roofer2, "select count(*) from requests") == 0)
check("a pending roofer sees no client details", one(roofer2, "select count(*) from profiles where id = %s", (homeowner,)) == 0)
check("clients don't see each other's requests", one(firm, "select count(*) from requests") == 1)
check("the admin sees every request", one(admin, "select count(*) from requests") == 3)

# ---------------------------------------------------------------- 5. replies

direct = one(homeowner, "select id::text from requests where company_id = 'del-sol-roofing'")
broadcast = one(homeowner, "select id::text from requests where company_id is null")
ok, _ = attempt(roofer, "insert into replies (request_id, company_id, message, price, eta) values (%s, 'del-sol-roofing', 'We can come Monday', '$450', 'Monday 8 AM')", (direct,))
check("the verified roofer replies", ok)
ok, err = attempt(roofer, "insert into replies (request_id, company_id, message) values (%s, 'del-sol-roofing', 'again')", (direct,))
check("one reply per company per request", not ok, err)
ok, err = attempt(roofer, "insert into replies (request_id, company_id, message) values (%s, 'miami-roof-tech', 'as someone else')", (broadcast,))
check("contractors can only reply as their own company", not ok, err)
ok, err = attempt(roofer2, "insert into replies (request_id, company_id, message) values (%s, 'miami-roof-tech', 'hi')", (broadcast,))
check("pending contractors can't reply", not ok, err)
ok, err = attempt(homeowner, "insert into replies (request_id, company_id, message) values (%s, 'del-sol-roofing', 'fake')", (broadcast,))
check("clients can't write replies", not ok, err)
check("the client sees the reply", one(homeowner, "select message from replies") == "We can come Monday")
check("other clients don't see it", one(firm, "select count(*) from replies") == 0)
check("reply count shows in public stats",
      one(None, "select reply_count from company_stats where company_id = 'del-sol-roofing'") == 1)
check("reply time shows in public stats",
      one(None, "select median_reply_minutes is not null from company_stats where company_id = 'del-sol-roofing'"))

# ---------------------------------------------------------------- 6. reviews

ok, err = attempt(homeowner, "insert into reviews (request_id, company_id, stars) values (%s, 'miami-roof-tech', 5)", (direct,))
check("clients can't review a company that didn't reply", not ok, err)
ok, err = attempt(firm, "insert into reviews (request_id, company_id, stars) values (%s, 'del-sol-roofing', 1)", (direct,))
check("clients can't review someone else's request", not ok, err)
ok, _ = attempt(homeowner, "insert into reviews (request_id, company_id, stars, body) values (%s, 'del-sol-roofing', 5, 'Fast and tidy')", (direct,))
check("the client reviews the company that replied", ok)
ok, err = attempt(homeowner, "insert into reviews (request_id, company_id, stars) values (%s, 'del-sol-roofing', 1)", (direct,))
check("one review per request", not ok, err)
ok, err = attempt(homeowner, "insert into reviews (request_id, company_id, stars) values (%s, 'del-sol-roofing', 9)", (broadcast,))
check("stars must be 1 to 5", not ok, err)
check("reviews are public", one(None, "select body from reviews") == "Fast and tidy")
ok, err = attempt(None, "select client_id from reviews")
check("reviews don't reveal who wrote them", not ok and "permission denied" in err, err)
check("clients find their own review through their request",
      one(homeowner, "select stars from reviews where request_id = %s", (direct,)) == 5)
check("average stars in public stats", float(one(None, "select avg_stars from company_stats where company_id = 'del-sol-roofing'")) == 5.0)

# ---------------------------------------------------------------- 7. request status

check("clients close their own request", attempt(homeowner, "update requests set status = 'done' where id = %s", (direct,))[1] == 1)
check("clients can't change someone else's request", attempt(firm, "update requests set status = 'cancelled' where id = %s", (direct,))[1] == 0)
ok, err = attempt(homeowner, "update requests set need = 'changed' where id = %s", (direct,))
check("only the status of a request can change", not ok, err)
ok, _ = attempt(homeowner, "update requests set status = 'cancelled' where id = %s", (broadcast,))
ok, err = attempt(roofer, "insert into replies (request_id, company_id, message) values (%s, 'del-sol-roofing', 'late')", (broadcast,))
check("no replies to cancelled requests", not ok, err)

# ---------------------------------------------------------------- 8. contractor tools

check("verified contractor sets availability", attempt(roofer, "select set_company_status('available', 'Crew free today')")[0])
check("availability is public", one(None, "select status || ' / ' || status_note from companies where id = 'del-sol-roofing'") == "available / Crew free today")
ok, err = attempt(roofer2, "select set_company_status('available', '')")
check("pending contractors can't set availability", not ok and "not verified" in err, err)
ok, err = attempt(roofer, "select set_company_status('asleep', '')")
check("unknown availability values are refused", not ok, err)
ok, _ = attempt(roofer, "select update_my_company('New description', 'hello@delsolroofing.com', 'Carla Diaz, owner', array['Roof repair','Re-roofing'], 'Miami-Dade')")
check("verified contractor edits company details", ok and one(None, "select contact from companies where id = 'del-sol-roofing'") == "Carla Diaz, owner")
ok, err = attempt(homeowner, "select update_my_company('x', null, null, null, null)")
check("clients can't edit company details", not ok, err)

# ---------------------------------------------------------------- 9. admin

ok, err = attempt(roofer, "select * from admin_pending_claims()")
check("non-admins can't list claims", not ok and "Admins only" in err, err)
ok, err = attempt(roofer, "select admin_decide_claim('miami-roof-tech', true)")
check("non-admins can't approve claims", not ok, err)
pending = one(admin, "select string_agg(company_id || ':' || full_name, ',' order by company_id) from admin_pending_claims()")
check("admin sees pending claims with the person's name", pending == "miami-pro-construction:Eva Mora,miami-roof-tech:Dan Ruiz", pending)
check("admin approves a claim", attempt(admin, "select admin_decide_claim('miami-roof-tech', true)")[0]
      and one(None, "select claim_status from companies where id = 'miami-roof-tech'") == "verified")
check("admin rejects a claim", attempt(admin, "select admin_decide_claim('miami-pro-construction', false)")[0]
      and one(None, "select claim_status from companies where id = 'miami-pro-construction'") == "none")
check("rejected contractor no longer linked", one(unconfirmed, "select company_id from profiles where id = auth.uid()") is None)

# ---------------------------------------------------------------- 10. new listings

new_id = one(newco, "select submit_company('services', 'Gus Builds LLC', 'General Contractor', '100 NW 1st St, Miami, FL 33128', '305-555-0107', 'https://gusbuilds.com', 'Small remodels', 'Owner · License CGC0000000')")
check("contractor adds an unlisted company", bool(new_id))
check("a new listing is hidden from the public until approved", one(None, "select count(*) from companies where id = %s", (new_id,)) == 0)
check("its branch is hidden too", one(None, "select count(*) from branches where company_id = %s", (new_id,)) == 0)
check("the person who added it can see it", one(newco, "select count(*) from companies where id = %s", (new_id,)) == 1)
check("admin approves the new listing", attempt(admin, "select admin_decide_claim(%s, true)", (new_id,))[0]
      and one(None, "select count(*) from branches where company_id = %s", (new_id,)) == 1)

# ---------------------------------------------------------------- 11. giving up a claim

check("contractor releases a claim", attempt(roofer2, "select release_claim()")[0]
      and one(None, "select claim_status from companies where id = 'miami-roof-tech'") == "none")

# ---------------------------------------------------------------- 12. realtime and re-seeding

tables = one(None, "select string_agg(tablename, ',' order by tablename) from pg_publication_tables where pubname = 'supabase_realtime'")
check("live updates enabled for companies, replies, requests", tables == "companies,replies,requests", tables)
run_file(db, ROOT / "supabase" / "seed.sql")
check("re-running the seed keeps claims", one(None, "select claim_status from companies where id = 'del-sol-roofing'") == "verified")
check("re-running the seed keeps availability", one(None, "select status from companies where id = 'del-sol-roofing'") == "available")
check("re-running the seed keeps reviews", one(None, "select count(*) from reviews") == 1)

# ---------------------------------------------------------------- summary

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
