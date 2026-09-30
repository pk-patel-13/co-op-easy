// Find page: filters, the sorted list and the map, for contractors or materials.

import { $, $$, esc, toast, saved } from "../lib/dom.js";
import { pickBranch } from "../lib/places.js";
import { state } from "../data/client.js";
import { loadStats, categoriesOf, companyById } from "../data/directory.js";
import { createMap } from "../components/map.js";
import { companyCard } from "../components/company-card.js";
import { categoryColor } from "../components/look.js";
import { openRequestForm } from "../components/request-form.js";
import { myLocation, setMyLocation } from "../components/location.js";

const SORTS = {
  near: "📍 Nearest open",
  fast: "⚡ Fastest reply",
  rated: "⭐ Best reviews",
};

// ---------- sorting (kept separate so it's easy to change) ----------

function sortRows(rows, sort) {
  const far = x => x.miles ?? 1e9;
  const byName = (a, b) => a.company.name.localeCompare(b.company.name);
  const list = [...rows];
  if (sort === "near") {
    list.sort((a, b) => (b.status.available - a.status.available) || (far(a) - far(b)) || byName(a, b));
  } else if (sort === "fast") {
    const quick = x => (x.branch && x.branch.always_open ? 2 : x.status.available ? 1 : 0);
    list.sort((a, b) => ((a.stats.median_reply_minutes ?? 1e9) - (b.stats.median_reply_minutes ?? 1e9))
      || (quick(b) - quick(a)) || (far(a) - far(b)) || byName(a, b));
  } else {
    list.sort((a, b) => ((b.stats.avg_stars ?? -1) - (a.stats.avg_stars ?? -1))
      || ((b.stats.review_count || 0) - (a.stats.review_count || 0)) || (far(a) - far(b)) || byName(a, b));
  }
  return list.map((row, i) => ({ ...row, number: i + 1 }));
}

function sortHint(sort, rows, me) {
  if (sort === "near") {
    return me ? `Open and available companies first, then the closest to ${esc(me.label)}.`
      : "Open and available companies first. Set your location to sort by distance.";
  }
  if (sort === "fast") {
    return rows.some(x => x.stats.reply_count) ? "Ranked by typical reply time to requests on Co-op."
      : "No replies on Co-op yet, so 24/7 and open-now companies come first.";
  }
  return rows.some(x => x.stats.review_count) ? "Ranked by average stars from Co-op clients."
    : "No reviews yet. Reviews appear after clients finish a request.";
}

// ---------- page ----------

export function renderFind(view, kind) {
  const filters = { category: "All", sort: saved.get("sort") || "near", search: "" };
  const categories = categoriesOf(kind);
  const other = kind === "services" ? "materials" : "services";

  view.innerHTML = `
    <div class="row between">
      <h1 class="title">${kind === "services" ? "Contractors & services" : "Building materials"}</h1>
      <a href="#/find/${other}">Looking for ${kind === "services" ? "materials" : "a contractor"} instead?</a>
    </div>

    <div class="card filters" style="margin-top:12px">
      <div class="filter-line"><span class="label">Type</span><div class="row" id="f-cats"></div></div>
      <div class="filter-line"><label class="label" for="f-zip">Your location</label>
        <div class="row">
          <input id="f-zip" class="input zip-input" inputmode="numeric" maxlength="5" placeholder="ZIP code">
          <button type="button" class="btn small" id="f-zip-set">Set</button>
          <button type="button" class="btn ghost small" id="f-geo">📍 Use my location</button>
          <span class="hint" id="f-loc-hint">or tap the map</span>
        </div></div>
      <div class="filter-line"><span class="label">Sort by</span>
        <div class="row" id="f-sorts">${Object.entries(SORTS).map(([key, label]) => `<button type="button" class="toggle" data-sort="${key}">${label}</button>`).join("")}</div></div>
      <div class="filter-line"><label class="label" for="f-search">Search</label>
        <input id="f-search" class="input" type="search" placeholder="${kind === "services" ? "Name or job, e.g. kitchen, re-roof, permits" : "Name or item, e.g. rebar, drywall, tile"}"></div>
    </div>

    <div class="row between" style="margin-top:18px">
      <b id="f-count"></b>
      <div class="row view-switch" role="group" aria-label="View">
        <button type="button" class="toggle" data-view="list" aria-pressed="true">List</button>
        <button type="button" class="toggle" data-view="map" aria-pressed="false">Map</button>
      </div>
    </div>
    <p class="hint" id="f-sort-hint" style="margin-top:4px"></p>
    <div class="results" id="f-results" data-view="list">
      <div class="list-col">
        <div class="result-list" id="f-list"></div>
      </div>
      <div class="map-box">
        <div class="map" id="f-map" role="region" aria-label="Map of companies"></div>
        <div class="legend" id="f-legend"></div>
      </div>
    </div>`;

  const map = createMap($("#f-map"), {
    onPickLocation: (lat, lng) => useLocation({ lat, lng, label: "your pin on the map" }),
    onPickCompany: id => highlight(id),
  });

  function useLocation(loc) {
    setMyLocation(loc);
    $("#f-loc-hint").textContent = `Using ${loc.label}`;
    filters.sort = "near";
    saved.set("sort", "near");
    update();
  }

  function highlight(id) {
    $$(".company-card").forEach(card => card.classList.toggle("active", card.dataset.company === id));
    const card = $(`.company-card[data-company="${CSS.escape(id)}"]`);
    if (card && $("#f-results").dataset.view === "list") card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function currentRows() {
    const me = myLocation();
    const words = filters.search.toLowerCase();
    const rows = state.companies
      .filter(c => c.kind === kind && c.approved !== false)
      .filter(c => filters.category === "All" || c.category === filters.category)
      .filter(c => !words || [c.name, c.category, ...(c.items || []), ...c.branches.map(b => b.address)].join(" ").toLowerCase().includes(words))
      .map(company => ({ company, stats: state.stats[company.id] || {}, ...pickBranch(company, me) }));
    return sortRows(rows, filters.sort);
  }

  function update() {
    if (!$("#f-list")) return; // left the page meanwhile
    const me = myLocation();
    $("#f-cats").innerHTML = ["All", ...categories].map(cat =>
      `<button type="button" class="chip" data-cat="${esc(cat)}" aria-pressed="${cat === filters.category}">${cat === "All" ? "" : `<i style="background:${categoryColor(cat)}"></i>`}${esc(cat)}</button>`).join("");
    $$("#f-sorts .toggle").forEach(b => b.setAttribute("aria-pressed", b.dataset.sort === filters.sort));
    const rows = currentRows();
    $("#f-count").textContent = `${rows.length} ${kind === "services" ? (rows.length === 1 ? "company" : "companies") : (rows.length === 1 ? "supplier" : "suppliers")}`;
    $("#f-sort-hint").innerHTML = sortHint(filters.sort, rows, me);
    $("#f-list").innerHTML = rows.length ? rows.map(companyCard).join("") : `<p class="muted">Nothing matches. Clear the search or pick "All".</p>`;
    $("#f-legend").innerHTML = categories.map(c => `<span><i style="background:${categoryColor(c)}"></i>${esc(c)}</span>`).join("")
      + `<span><i style="background:var(--blue);border-radius:50%;transform:none"></i>You</span>`;
    map.show(rows, me);
  }

  // ---------- events ----------
  $("#f-cats").addEventListener("click", e => {
    const chip = e.target.closest(".chip");
    if (chip) { filters.category = chip.dataset.cat; update(); }
  });
  $("#f-sorts").addEventListener("click", e => {
    const b = e.target.closest(".toggle");
    if (b) { filters.sort = b.dataset.sort; saved.set("sort", filters.sort); update(); }
  });
  $("#f-search").addEventListener("input", e => { filters.search = e.target.value; update(); });

  const setZip = () => {
    const zip = $("#f-zip").value.trim();
    const point = state.zips[zip];
    if (!point) { $("#f-loc-hint").textContent = "That's not a Florida ZIP code. Try 33130."; return; }
    useLocation({ lat: point[0], lng: point[1], label: `ZIP ${zip}`, zip });
  };
  $("#f-zip-set").addEventListener("click", setZip);
  $("#f-zip").addEventListener("keydown", e => { if (e.key === "Enter") setZip(); });
  $("#f-geo").addEventListener("click", () => {
    if (!navigator.geolocation) { toast("Your browser can't share location. Enter a ZIP code instead."); return; }
    navigator.geolocation.getCurrentPosition(
      pos => useLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: "your current location" }),
      () => toast("Location is blocked. Enter a ZIP code instead."),
      { timeout: 10000 },
    );
  });

  $("#f-list").addEventListener("click", e => {
    const request = e.target.closest("[data-request]");
    if (request) openRequestForm(companyById(request.dataset.request));
    const onMap = e.target.closest("[data-show-on-map]");
    if (onMap) {
      if ($("#f-results").dataset.view === "list" && getComputedStyle($(".view-switch")).display !== "none") setView("map");
      map.focus(onMap.dataset.showOnMap);
    }
  });

  function setView(which) {
    $("#f-results").dataset.view = which;
    $$(".view-switch .toggle").forEach(x => x.setAttribute("aria-pressed", x.dataset.view === which));
    map.resize();
  }
  $(".view-switch").addEventListener("click", e => {
    const b = e.target.closest("[data-view]");
    if (b) setView(b.dataset.view);
  });

  const me = myLocation();
  if (me) { $("#f-loc-hint").textContent = `Using ${me.label}`; if (me.zip) $("#f-zip").value = me.zip; }
  update();
  loadStats().then(update);
  const clock = setInterval(update, 60000); // opening hours change with the clock

  return () => { clearInterval(clock); map.destroy(); };
}
