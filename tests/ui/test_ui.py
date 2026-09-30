"""Browser tests: clicks through the real site in Microsoft Edge (or Chrome) like a person would.

    pip install playwright
    python tests/ui/test_ui.py                   # uses the Edge already on the computer
    BROWSER=chrome python tests/ui/test_ui.py    # or Chrome
    BROWSER=chromium python tests/ui/test_ui.py  # or Playwright's Chromium (run `playwright install chromium` first)

Part 1 runs the site in preview mode (no database).
Part 2 swaps Supabase for tests/ui/fake-supabase.js and runs every account flow:
sign up, request, claim, reply, availability, review, admin approval, new listing.
"""
import http.server
import json
import os
import socketserver
import sys
import threading
from datetime import datetime, timezone
from functools import partial
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
FAKE = (ROOT / "tests" / "ui" / "fake-supabase.js").read_text(encoding="utf-8")
COMPANIES = json.loads((ROOT / "data" / "companies.json").read_text(encoding="utf-8"))

results = []


def check(name, condition, detail=""):
    results.append((name, bool(condition)))
    print(("PASS " if condition else "FAIL ") + name + (f"  ({detail})" if detail and not condition else ""))
    if not condition and os.environ.get("GITHUB_ACTIONS"):  # show failures on the GitHub run page
        print(f"::error title=Test failed::{name} {str(detail)[:300]}")


def pins_expected(kind):
    return sum(1 for c in COMPANIES if c["kind"] == kind for b in c["branches"] if b["lat"] is not None)


# ---------------------------------------------------------------- local web server

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), partial(Quiet, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{server.server_address[1]}/"


# ---------------------------------------------------------------- helpers

def open_page(browser, live=False, mobile=False, dark=False, clock=None):
    context = browser.new_context(
        viewport={"width": 390, "height": 844} if mobile else {"width": 1280, "height": 900},
        color_scheme="dark" if dark else "light",
    )
    if live:
        context.route("**/js/config.js", lambda route: route.fulfill(
            content_type="application/javascript",
            body='export const SUPABASE_URL = "https://fake.supabase.co"; export const SUPABASE_ANON_KEY = "test";'))
        context.route("https://cdn.jsdelivr.net/npm/@supabase/**", lambda route: route.fulfill(
            content_type="application/javascript", body=FAKE))
    page = context.new_page()
    page.errors = []
    page.on("pageerror", lambda e: page.errors.append(str(e)))
    page.on("console", lambda m: page.errors.append(m.text) if m.type == "error" else None)
    if clock:
        page.clock.install(time=clock)
    return page


def go(page, hash_part, wait="#view > *:not(p.muted)", state="visible"):
    if page.url == BASE + hash_part:
        page.reload()          # same address: reload so forms start empty
    else:
        page.goto(BASE + hash_part)
    page.wait_for_selector(wait, state=state)


def wait_hash(page, value):
    page.wait_for_function(f"location.hash === {json.dumps(value)}")


def toast_text(page):
    page.wait_for_selector("#toast:not([hidden])")
    return page.inner_text("#toast")


def no_side_scroll(page):
    return page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")


# ---------------------------------------------------------------- part 1: preview mode

def preview_tests(browser):
    page = open_page(browser)

    go(page, "#/", ".hero")
    check("home: shows 9 company images", page.locator(".hero-art .tile").count() == 9)
    check("home: counts 10 contractors", "10 contractors" in page.inner_text(".choices"))
    check("home: counts 13 suppliers", "13 suppliers" in page.inner_text(".choices"))
    check("home: preview banner shows", page.is_visible("#demo-banner"))
    page.click("text=How it works")
    check("home: 'How it works' link scrolls to the section", page.is_visible("#how"))

    go(page, "#/find/services", ".company-card")
    check("find: 10 service companies", page.locator(".company-card").count() == 10)
    page.wait_for_selector(".maplibregl-canvas")
    check("find: map draws", page.locator(".maplibregl-canvas").count() == 1)
    check(f"find: {pins_expected('services')} pins for service branches",
          page.locator("#f-map .pin").count() == pins_expected("services"), page.locator("#f-map .pin").count())
    check("find: every card links to the real website",
          page.locator(".company-card a.site-link").count() == sum(1 for c in COMPANIES if c["kind"] == "services" and c["website"]))

    page.click('#f-cats .chip[data-cat="Roofing Contractor"]')
    check("find: category filter (2 roofers)", page.locator(".company-card").count() == 2)
    check("find: map follows the filter", page.locator("#f-map .pin").count() == 2)
    page.click('#f-cats .chip[data-cat="All"]')
    page.fill("#f-search", "permits")
    check("find: search finds the permit expediter", page.locator(".company-card").count() == 1 and "East of Collins" in page.inner_text("#f-list"))
    page.fill("#f-search", "zzzz")
    check("find: search with no match says so", "Nothing matches" in page.inner_text("#f-list"))
    page.fill("#f-search", "")

    page.fill("#f-zip", "99999")
    page.click("#f-zip-set")
    check("find: bad ZIP explains itself", "not a Florida ZIP" in page.inner_text("#f-loc-hint"))
    page.fill("#f-zip", "33130")
    page.click("#f-zip-set")
    check("find: ZIP sets the location", "ZIP 33130" in page.inner_text("#f-loc-hint"))
    check("find: 'you' dot and 5-mile ring on the map", page.locator(".me-dot").count() == 1)
    rows = page.eval_on_selector_all(".company-card", """cards => cards.map(c => ({
        open: !c.classList.contains('closed'),
        miles: parseFloat(c.querySelector('.distance').textContent) }))""")
    open_first = all(rows[i]["open"] >= rows[i + 1]["open"] for i in range(len(rows) - 1))
    def ascending(group):
        values = [r["miles"] for r in group if r["miles"] == r["miles"]]
        return values == sorted(values)
    check("find: nearest-open puts open companies first", open_first, rows)
    check("find: then sorts by distance", ascending([r for r in rows if r["open"]]) and ascending([r for r in rows if not r["open"]]), rows)

    page.click('#f-sorts [data-sort="rated"]')
    check("find: sort buttons switch", page.get_attribute('#f-sorts [data-sort="rated"]', "aria-pressed") == "true")
    check("find: explains empty reviews", "No reviews yet" in page.inner_text("#f-sort-hint"))
    page.click('#f-sorts [data-sort="near"]')

    go(page, "#/find/materials", ".company-card")
    check("materials: 13 suppliers", page.locator(".company-card").count() == 13)
    page.wait_for_selector("#f-map .pin")
    check(f"materials: {pins_expected('materials')} pins, one per branch",
          page.locator("#f-map .pin").count() == pins_expected("materials"), page.locator("#f-map .pin").count())
    srs = page.locator('.company-card[data-company="srs-building-products"]')
    check("materials: SRS shows 3 branches", "3 branches" in srs.inner_text())
    check("materials: SRS names its nearest branch", "Nearest:" in srs.inner_text())
    page.click('[data-show-on-map="cemex"]')
    page.wait_for_selector(".maplibregl-popup")
    check("materials: 'Show on map' opens the company's popup", "Cemex" in page.inner_text(".maplibregl-popup"))
    page.fill("#f-search", "rebar")
    check("materials: search by item (rebar)", page.locator(".company-card").count() >= 3)

    go(page, "#/company/srs-building-products", ".profile")
    check("company: SRS lists 3 branches", page.locator(".branch-item").count() == 3)
    page.wait_for_selector("#c-map .pin")
    check("company: SRS map shows 3 pins", page.locator("#c-map .pin").count() == 3)
    check("company: branch managers shown", "Abe Cordoba" in page.inner_text(".branch-list"))
    check("company: name links to the real website", page.get_attribute(".profile h1 a", "href").startswith("https://www.srsdistribution.com"))
    check("company: directions link per branch", page.locator('.branch-item a[href*="google.com/maps/dir"]').count() == 3)
    img, cap = page.locator(".profile-image img").bounding_box(), page.locator(".profile-image figcaption").bounding_box()
    check("company: image caption sits under the logo", cap["y"] >= img["y"] + img["height"] - 1, (img, cap))
    page.click("#c-request")
    check("company: requests explain preview mode", "preview mode" in toast_text(page))

    go(page, "#/company/vc-construction", ".profile")
    check("company: no-address company still works", page.locator(".branch-item").count() == 1 and page.locator("#c-map .pin").count() == 0)
    go(page, "#/company/does-not-exist", ".card")
    check("company: unknown company says not found", "Company not found" in page.inner_text("#view"))
    go(page, "#/nowhere", ".card")
    check("router: unknown address says not found", "Page not found" in page.inner_text("#view"))
    go(page, "#/signup", ".card")
    check("preview: sign-up explains accounts are off", "coming soon" in page.inner_text("#view"))
    check("preview: no console errors", not page.errors, page.errors[:3])
    page.context.close()


def clock_tests(browser):
    # Tuesday 29 Sept 2026, 10:00 in Miami (14:00 UTC)
    page = open_page(browser, clock=datetime(2026, 9, 29, 14, 0, tzinfo=timezone.utc))
    go(page, "#/company/florida-lumber", ".profile")
    check("hours: Tuesday 10 AM, Florida Lumber is open", "Open · closes 4 PM" in page.inner_text(".profile"))
    page.context.close()
    # Tuesday 5:30 AM in Miami
    page = open_page(browser, clock=datetime(2026, 9, 29, 9, 30, tzinfo=timezone.utc))
    go(page, "#/company/florida-lumber", ".profile")
    check("hours: before opening says when it opens", "Closed · opens 6:30 AM" in page.inner_text(".profile"))
    page.context.close()
    # Sunday noon in Miami
    page = open_page(browser, clock=datetime(2026, 9, 27, 16, 0, tzinfo=timezone.utc))
    go(page, "#/company/florida-lumber", ".profile")
    check("hours: Sunday, Florida Lumber is closed", "Closed now" in page.inner_text(".profile"))
    go(page, "#/company/jobmix-concrete", ".profile")
    check("hours: 24/7 company is open on Sunday", "Open 24/7" in page.inner_text(".profile"))
    page.context.close()


def phone_and_dark_tests(browser):
    page = open_page(browser, mobile=True)
    for hash_part in ["#/", "#/find/services", "#/find/materials", "#/company/srs-building-products", "#/company/del-sol-roofing", "#/signup"]:
        go(page, hash_part)
        page.wait_for_timeout(300)
        check(f"phone: no sideways scrolling on {hash_part}", no_side_scroll(page),
              page.evaluate("[document.documentElement.scrollWidth, innerWidth]"))
    go(page, "#/find/services", ".company-card")
    check("phone: list shows first, map hidden", not page.is_visible("#f-map"))
    page.click('.view-switch [data-view="map"]')
    page.wait_for_selector("#f-map .pin")
    check("phone: Map button shows the map", page.is_visible("#f-map") and not page.is_visible("#f-list"))
    page.click('.view-switch [data-view="list"]')
    check("phone: List button brings the list back", page.is_visible("#f-list"))
    page.click('[data-show-on-map="del-sol-roofing"]')
    page.wait_for_selector(".maplibregl-popup")
    check("phone: 'Show on map' switches to the map", page.is_visible("#f-map"))
    check("phone: no console errors", not page.errors, page.errors[:3])
    page.context.close()

    page = open_page(browser, dark=True)
    styles = []
    page.on("request", lambda r: styles.append(r.url) if "openfreemap.org/styles" in r.url else None)
    go(page, "#/find/materials", ".company-card")
    bg = page.evaluate("getComputedStyle(document.body).backgroundColor")
    check("dark mode: dark background", bg == "rgb(14, 17, 36)", bg)
    page.wait_for_selector(".maplibregl-canvas")
    check("dark mode: dark map style loads", any(u.endswith("/fiord") for u in styles), styles)
    page.screenshot(path=str(ROOT / "tests" / "ui" / "last-dark.png"))
    page.context.close()


# ---------------------------------------------------------------- part 2: accounts (fake Supabase)

def sign_up(page, name, email, role="client", phone="305-555-0101", zip_code="33130", business=None):
    go(page, "#/signup" + ("?role=contractor" if role == "contractor" else ""), "#signup")
    page.fill("#su-name", name)
    page.fill("#su-phone", phone)
    page.fill("#su-zip", zip_code)
    if business:
        page.select_option("#su-type", "business")
        page.fill("#su-biz", business)
    page.fill("#su-email", email)
    page.fill("#su-pass", "password123")
    page.click("#signup button[type=submit]")
    wait_hash(page, "#/account")
    page.wait_for_selector("#acc-profile h1")


def sign_out(page):
    go(page, "#/account", "#pf-out", state="attached")
    page.click("#pf-out")
    wait_hash(page, "#/")


def sign_in(page, email, password="password123"):
    go(page, "#/login", "#login")
    page.fill("#li-email", email)
    page.fill("#li-pass", password)
    page.click("#login button[type=submit]")


def account_tests(browser):
    page = open_page(browser, live=True)
    go(page, "#/", ".hero")
    check("live: preview banner hidden", not page.is_visible("#demo-banner"))
    check("live: header offers sign in and join", "Join free" in page.inner_text("#nav-account"))

    # --- sign-up form checks
    go(page, "#/signup", "#signup")
    page.click("#signup button[type=submit]")
    err = page.inner_text("#su-error")
    check("signup: empty form lists what's missing", all(x in err for x in ["full name", "phone", "ZIP", "email", "password"]), err)
    page.check('input[value="contractor"]')
    check("signup: contractors don't see homeowner/business", not page.is_visible("#su-type"))
    check("signup: contractors get the work-email tip", "website domain" in page.inner_text("#su-email-hint"))
    page.check('input[value="client"]')
    page.select_option("#su-type", "business")
    check("signup: business shows business name", page.is_visible("#su-biz"))

    # --- a homeowner signs up and sends two requests
    sign_up(page, "Ana Lopez", "ana@example.com")
    check("client: lands on the account page", "Ana Lopez" in page.inner_text("#acc-profile"))
    check("client: header greets by name", "Ana's account" in page.inner_text("#nav-account"))
    check("client: account type shown", "Homeowner" in page.inner_text("#acc-profile"))
    page.wait_for_selector("#acc-requests h2")
    check("client: empty requests explained", "No requests yet" in page.inner_text("#acc-requests"))

    go(page, "#/company/del-sol-roofing", ".profile")
    page.click("#c-request")
    check("request: ZIP filled from the profile", page.input_value("#rq-zip") == "33130")
    page.fill("#rq-need", "ab")
    page.click("#request-form button[type=submit]")
    check("request: too-short need is refused", "at least 3" in page.inner_text("#rq-error"))
    page.fill("#rq-need", "Fix a leak over the kitchen")
    page.fill("#rq-details", "Tile roof, about 20 years old")
    page.click("#request-form button[type=submit]")
    wait_hash(page, "#/account")
    page.wait_for_selector("#acc-requests .request")
    check("request: shows in my requests, waiting", "Waiting for replies" in page.inner_text("#acc-requests"))

    go(page, "#/company/miami-roof-tech", ".profile")
    page.click("#c-request")
    page.fill("#rq-need", "Re-roof quote, 2,000 sq ft")
    page.check("#rq-all")
    page.click("#request-form button[type=submit]")
    wait_hash(page, "#/account")
    page.wait_for_selector("#acc-requests .request >> nth=1")
    check("request: sent to the whole category", "all Roofing Contractor companies" in page.inner_text("#acc-requests"))

    # --- the roofer signs up with a work email and is verified instantly
    sign_out(page)
    check("signout: header back to sign in", "Sign in" in page.inner_text("#nav-account"))
    sign_up(page, "Carla Diaz", "info@delsolroofing.com", role="contractor", phone="305-555-0103")
    page.wait_for_selector("#cl-form")
    page.click("#cl-form button[type=submit]")
    check("claim: must choose a company", "Choose your company" in toast_text(page))
    page.select_option("#cl-company", "del-sol-roofing")
    page.fill("#cl-title", "Owner")
    page.fill("#cl-license", "CCC1328657")
    page.click("#cl-form button[type=submit]")
    page.wait_for_selector("text=Verified manager")
    check("claim: work email verified instantly", True)
    page.wait_for_selector("#db-incoming .request")
    incoming = page.inner_text("#db-incoming")
    check("dashboard: sees both roofing requests", page.locator("#db-incoming .request").count() == 2, incoming)
    check("dashboard: sees the client's name and phone", "Ana Lopez" in incoming and "305-555-0101" in incoming)
    check("dashboard: shows distance to the job", "mi from your nearest branch" in incoming)

    page.click('#db-incoming .request:has-text("Fix a leak") [data-reply]')
    page.click("#rp-form button[type=submit]")
    check("reply: empty message refused", "write a message" in toast_text(page))
    page.fill("#rp-msg", "We can come Monday morning")
    page.fill("#rp-price", "$450")
    page.fill("#rp-eta", "Monday 8 AM")
    page.click("#rp-form button[type=submit]")
    page.wait_for_selector('#db-incoming .request:has-text("Fix a leak") >> text=You replied')
    check("reply: marked as replied", True)

    page.click('#db-status [data-status="available"]')
    page.wait_for_selector('#db-status [data-status="available"][aria-pressed="true"]')
    check("availability: set to Available", True)

    go(page, "#/find/services", ".company-card")
    card = page.inner_text('.company-card[data-company="del-sol-roofing"]')
    check("find: shows Available now", "Available now" in card, card)
    check("find: shows reply speed", "Replies in" in card, card)
    check("find: shows it's on Co-op", "On Co-op" in card, card)

    # --- the client reads the reply and reviews
    sign_out(page)
    sign_in(page, "ana@example.com", "wrong-password")
    page.wait_for_selector("#li-error:not([hidden])")
    check("login: wrong password explained", "Wrong email or password" in page.inner_text("#li-error"))
    sign_in(page, "ana@example.com")
    wait_hash(page, "#/account")
    page.wait_for_selector("#acc-requests .reply")
    text = page.inner_text("#acc-requests")
    check("client: sees the reply with price and start", "We can come Monday morning" in text and "$450" in text and "Monday 8 AM" in text)
    page.click("[data-review]")
    page.click('#rv-stars [data-n="4"]')
    page.fill("#rv-body", "Quick and tidy")
    page.click("#rv-form button[type=submit]")
    page.wait_for_selector("#acc-requests >> text=You rated")
    check("review: request marked done", "Done" in page.inner_text("#acc-requests"))

    go(page, "#/company/del-sol-roofing", ".profile")
    page.wait_for_selector("#c-reviews .review")
    check("company: review is public", "★★★★☆" in page.inner_text("#c-reviews") and "Quick and tidy" in page.inner_text("#c-reviews"))
    check("company: rating in stats", "★ 4.0" in page.inner_text("#c-stats"))

    # --- profile edit and cancel
    go(page, "#/account", "#pf-form", state="attached")
    page.click("#acc-profile summary")
    page.fill("#pf-phone", "305-555-0199")
    page.click("#pf-form button[type=submit]")
    page.wait_for_selector("#acc-profile >> text=305-555-0199")
    check("profile: phone updated", True)
    page.wait_for_selector("[data-cancel]")
    page.click("[data-cancel]")
    check("cancel: asks to tap again", "Tap again" in page.inner_text("[data-cancel]"))
    page.click("[data-cancel]")
    page.wait_for_selector("#acc-requests >> text=Cancelled")
    check("cancel: request cancelled", True)

    # --- a second roofer waits for the admin
    sign_out(page)
    sign_up(page, "Dan Ruiz", "dan.roofs@gmail.com", role="contractor", phone="305-555-0104")
    page.wait_for_selector("#cl-form")
    page.select_option("#cl-company", "miami-roof-tech")
    page.fill("#cl-title", "Manager")
    page.click("#cl-form button[type=submit]")
    page.wait_for_selector("#acc-company >> text=Waiting for Co-op")
    check("claim: other emails wait for review", True)
    check("claim: a company can't be claimed twice", page.evaluate(
        "__fake.dump().companies.filter(c => c.claimed_by).length") == 2)

    sign_out(page)
    sign_up(page, "Site Owner", "owner@co-op.example")
    page.evaluate("__fake.makeAdmin('owner@co-op.example')")
    page.reload()
    page.wait_for_selector("#acc-profile >> text=Admin: review claims")
    check("admin: sees the admin button", True)
    go(page, "#/admin", "#ad-claims .card")
    claims = page.inner_text("#ad-claims")
    check("admin: sees who is claiming", "Miami Roof-Tech" in claims and "Dan Ruiz" in claims and "dan.roofs@gmail.com" in claims)
    page.click('[data-decide="approve"]')
    page.wait_for_selector("#ad-claims >> text=Nothing waiting")
    check("admin: approves the claim", True)

    sign_out(page)
    sign_in(page, "dan.roofs@gmail.com")
    wait_hash(page, "#/account")
    page.wait_for_selector("text=Verified manager")
    check("claim: approved contractor gets the dashboard", True)

    # --- a contractor adds a company that isn't listed
    sign_out(page)
    sign_up(page, "Gus Pena", "gus@gusbuilds.com", role="contractor", phone="305-555-0107")
    page.wait_for_selector("#cl-form")
    page.click("#acc-company summary")
    page.fill("#nc-name", "Gus Builds LLC")
    page.fill("#nc-cat", "General Contractor")
    page.fill("#nc-title", "Owner")
    page.click("#nc-form button[type=submit]")
    page.wait_for_selector("#acc-company >> text=Waiting for Co-op")
    check("new listing: waits for review", "Gus Builds LLC" in page.inner_text("#acc-company"))
    go(page, "#/find/services", ".company-card")
    check("new listing: hidden from the directory until approved", "Gus Builds" not in page.inner_text("#f-list"))

    check("accounts: no console errors", not page.errors, page.errors[:3])
    page.context.close()

    # --- email confirmation turned on (the recommended Supabase setting)
    page = open_page(browser, live=True)
    go(page, "#/", ".hero")
    page.evaluate("localStorage.setItem('fake-confirm-email', 'on')")
    go(page, "#/signup", "#signup")
    page.fill("#su-name", "Rosa Vega")
    page.fill("#su-phone", "305-555-0110")
    page.fill("#su-zip", "33145")
    page.fill("#su-email", "rosa@example.com")
    page.fill("#su-pass", "password123")
    page.click("#signup button[type=submit]")
    page.wait_for_selector("text=Check your email")
    check("signup: asks to confirm the email", "rosa@example.com" in page.inner_text("#view"))
    go(page, "#/company/cemex", ".profile")
    page.click("#c-request")
    wait_hash(page, "#/signup")
    check("request: signed-out visitors are sent to sign up", "Create a free account" in toast_text(page))
    page.context.close()


# ---------------------------------------------------------------- run

with sync_playwright() as p:
    # BROWSER=edge (default, uses the installed Edge), chrome, or chromium (Playwright's own, used on GitHub)
    channel = {"edge": "msedge", "chrome": "chrome", "chromium": None}[os.environ.get("BROWSER", "edge")]
    browser = p.chromium.launch(channel=channel, headless=True)
    for part in (preview_tests, clock_tests, phone_and_dark_tests, account_tests):
        try:
            part(browser)
        except Exception as e:  # a crash in one part shouldn't hide the others
            check(f"{part.__name__} ran to the end", False, " | ".join(str(e).splitlines()[:6]))
    browser.close()

server.shutdown()
failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
