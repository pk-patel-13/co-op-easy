# Co-op

Co-op connects people who need construction work or materials in Miami with the contractors and suppliers who can do it.

- **Clients** (homeowners and construction firms) find companies near them, see who's open right now, who replies fast and who has good reviews, and send a request.
- **Contractors and suppliers** claim their company, mark themselves available, reply with a price and a start date, and collect reviews.

It's plain HTML, CSS and JavaScript with no build step, so GitHub Pages hosts it for free. Accounts, requests and reviews live in [Supabase](https://supabase.com) (free plan). The map uses [OpenFreeMap](https://openfreemap.org) (free, no key, no usage limits).

---

## Where to change what

| I want to change… | Edit |
|---|---|
| Colors, fonts, roundness (the whole look) | `css/tokens.css` |
| Header, footer, page width | `css/base.css`, `index.html` |
| Buttons, pills, cards, forms | `css/components.css` |
| Map pins, popups, legend | `css/map.css` |
| The map style (streets, water colors) | `STYLE_LIGHT` / `STYLE_DARK` in `js/components/map.js` |
| Layout of one page | its section in `css/pages.css` (sections follow the page order) |
| Text or layout on a page | `js/pages/…` (one file per page; the account page is a folder) |
| How companies are sorted | `sortRows` at the top of `js/pages/find.js` |
| Opening-hours logic | `js/lib/time.js` |
| Which branch is shown, distances | `js/lib/places.js` |
| A database call | `js/data/…` (grouped by feature: directory, account, requests, contractor, admin) |
| Company or branch details | `data/companies.json`, then `python tools/build_seed.py` |
| Who may see or change what | `supabase/03_security.sql` |

## Folder layout

```
index.html                  page shell: header, footer, where pages appear
css/
  tokens.css                colors and fonts
  base.css                  reset, header, footer
  components.css            buttons, fields, pills, cards, dialog
  map.css                   pins, popups, legend
  pages.css                 one section per page
js/
  app.js                    starts the app and picks the page (#/find/services …)
  config.js                 your Supabase keys
  lib/                      helpers: dom.js, time.js, places.js
  data/                     every database call: client, directory, account, requests, contractor, admin, live
  components/               shared pieces: map, company-card, request-form, dialog, nav, look, location
  pages/                    home, find, company, signup, login, admin, account/ (index, profile, my-requests, contractor)
data/
  companies.json            the 23 companies and their 28 branches (the one source of truth)
  zips.json                 Florida ZIP code locations (US Census)
images/                     logos and photos from each company's own website
supabase/
  01_tables.sql             tables
  02_functions.sql          sign-up setup, claiming, availability, admin actions
  03_security.sql           who can read and write what
  04_realtime.sql           live updates
  seed.sql                  the companies (generated, don't edit by hand)
tools/build_seed.py         rebuilds seed.sql from data/companies.json
tests/db/                   database tests (real PostgreSQL)
tests/ui/                   browser tests (Edge / Chrome / Chromium)
.github/workflows/tests.yml runs both test suites on GitHub
```

## Try it on your computer

```bash
python -m http.server 8000
```

Open http://localhost:8000. Without Supabase keys the site runs in **preview mode**: browsing, the map and company pages work, but sign-up and requests are off.

## Branches: `main` is live, `dev` is for work

- **`main`** is what GitHub Pages shows at your live address. Only merge into it when tests pass.
- **`dev`** is where you make changes.

```bash
git switch dev                  # start working
# …edit files, try them with: python -m http.server 8000
git add -A
git commit -m "Describe the change"
git push                        # GitHub runs the tests on dev

# when the Tests check on GitHub is green:
git switch main
git merge dev
git push                        # the live site updates in about a minute
git switch dev
```

For bigger changes, make a branch from `dev` (`git switch -c new-feature`), then open a pull request into `main` on GitHub. The tests run on the pull request, and you merge when they're green.

## Put it online (GitHub Pages)

1. Create a **public** repository on GitHub (for example `co-op`).
2. Push both branches:
   ```bash
   git remote add origin https://github.com/YOUR-USERNAME/co-op.git
   git push -u origin main
   git push -u origin dev
   ```
3. On GitHub: **Settings → Pages → Deploy from a branch → main → / (root) → Save**.
4. The site is live at `https://YOUR-USERNAME.github.io/co-op/` in about a minute.

## Turn on accounts (Supabase, free)

1. Create a project at [supabase.com](https://supabase.com) (free plan, region US East).
2. **SQL Editor → New query**: run each file in `supabase/` in order, pasting and running one at a time: `01_tables.sql`, `02_functions.sql`, `03_security.sql`, `04_realtime.sql`, `seed.sql`.
3. **Authentication → URL Configuration**
   - Site URL: `https://YOUR-USERNAME.github.io/co-op/`
   - Redirect URLs: `https://YOUR-USERNAME.github.io/co-op/**` and `http://localhost:8000/**`
4. **Authentication → Providers → Email**: keep **Confirm email** on. It proves a contractor owns their work email.
5. **Project Settings → API**: copy the Project URL and the **anon public** key into `js/config.js`. The anon key is safe to publish. **Never** put the `service_role` key in this repo.
6. Commit to `dev`, check it, merge to `main`.

**Make yourself admin:** sign up on your site, then in the SQL Editor run:

```sql
update public.profiles set is_admin = true where email = 'you@example.com';
```

## How company verification works

- **Instant:** a contractor whose *confirmed* email is on the company's website domain (for example `info@delsolroofing.com` for delsolroofing.com) is verified as soon as they claim the company.
- **Manual:** anyone else waits. The admin page shows their name, phone, email, role and Florida license number. Check the license on [MyFloridaLicense.com](https://www.myfloridalicense.com/wl11.asp?mode=0&SID=), or call the company's published number, then approve or reject.

Verified contractors see requests sent to their company or to their whole category, with the client's name, phone and email. Nothing else.

## Tests

```bash
pip install pgserver "psycopg[binary]" playwright
python tests/db/test_database.py     # 84 checks: every security rule and function, on real PostgreSQL
python tests/ui/test_ui.py           # 100 checks in the browser (uses Microsoft Edge)
```

- **Database tests** start a throwaway PostgreSQL, run every file in `supabase/`, then act as a signed-out visitor, clients, contractors and an admin. They check what each person can and can't see or change.
- **Browser tests** click through the real site: filters, sorting, ZIP codes, map pins and popups, branches, opening hours at fixed times, phone-sized screens, dark mode. They also run every account flow (sign up, request, claim, reply, availability, review, admin approval, new listing) against `tests/ui/fake-supabase.js`, a stand-in that follows the same rules as the database.

GitHub runs both on every push to `dev` or `main` (see the **Actions** tab).

## Free plan limits

| Service | Free limit | What it means |
|---|---|---|
| GitHub Pages | Public repo, 100 GB/month | Plenty for a local directory |
| Supabase | 500 MB database, 50,000 monthly users | Plenty to start. A project **pauses after 7 days with no visits**; open the dashboard to wake it |
| Supabase email | A few sign-up emails per hour | Fine for testing. Before launch, add a free SMTP sender such as [Resend](https://resend.com) (3,000 emails/month) under **Authentication → SMTP Settings** |
| OpenFreeMap | No key, no limits | Nothing to set up |
| GitHub Actions | Free for public repos | Tests run on every push |

## Where the data comes from

- **Companies and branches:** each company's official website and branch pages, checked 2026-09-30. Branch managers are named only where the company publishes them. Every company name links to its website.
- **Branches:** SRS Building Products (3), Cemex (3 Miami plants) and Rexel (2) have more than one location. South Dade Electrical mentions three warehouses but publishes one address, so only that one is listed.
- **Images:** logos and photos from each company's own website. The six companies without a confirmed image of their own show colored initials.
- **Ratings and reply times:** only from requests and reviews made on Co-op. Nothing is copied from Google or Yelp.
- **ZIP code locations:** US Census Bureau 2023 gazetteer. **Map:** OpenFreeMap, © OpenStreetMap contributors.
