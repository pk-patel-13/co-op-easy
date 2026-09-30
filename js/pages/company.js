// One company's page: image, details from its website, every branch, live status, reviews.

import { $, esc } from "../lib/dom.js";
import { formatMinutes, timeAgo } from "../lib/time.js";
import { companyStatus, directionsUrl, siteLabel, phoneNumber, pickBranch } from "../lib/places.js";
import { live, state } from "../data/client.js";
import { companyById, loadReviews, loadStats } from "../data/directory.js";
import { categoryColor, stars } from "../components/look.js";
import { createMap } from "../components/map.js";
import { openRequestForm } from "../components/request-form.js";
import { myLocation } from "../components/location.js";

function phoneLines(phones) {
  return (phones || []).map(p => `<div>${esc(p)}<button class="copy" type="button" data-copy="${esc(phoneNumber(p))}">copy</button></div>`).join("");
}

function branchItem(company, branch) {
  const status = companyStatus(company, branch);
  return `<div class="branch-item">
    <div class="row between"><h3>${esc(branch.name)}</h3><span class="pill ${status.tone}">${esc(status.text)}</span></div>
    <span>${esc(branch.address)}${branch.approx_location ? " (map pin approximate)" : ""}</span>
    ${branch.hours_text ? `<span class="small muted">${esc(branch.hours_text)}</span>` : ""}
    ${branch.contact ? `<span class="small"><b>Contact:</b> ${esc(branch.contact)}</span>` : ""}
    <div class="small">${phoneLines(branch.phones)}</div>
    <div class="row">
      ${branch.lat != null ? `<a class="btn ghost small" href="${directionsUrl(company, branch)}" target="_blank" rel="noopener">Directions ↗</a>` : ""}
      ${branch.page && branch.page !== company.website ? `<a class="small" href="${esc(branch.page)}" target="_blank" rel="noopener">Branch page ↗</a>` : ""}
    </div>
  </div>`;
}

export function renderCompany(view, id) {
  const c = companyById(id);
  if (!c) {
    view.innerHTML = `<div class="card"><h1 class="title">Company not found</h1><p><a href="#/find/services">Back to the directory</a></p></div>`;
    return;
  }
  const { branch, status } = pickBranch(c, myLocation());
  const many = c.branches.length > 1;

  view.innerHTML = `
    <p class="small"><a href="#/find/${c.kind}">← All ${c.kind === "services" ? "contractors" : "suppliers"}</a></p>
    <div class="profile" style="margin-top:12px">
      <div class="stack">
        ${c.image_url ? `<figure class="profile-image ${c.image_is_photo ? "" : "is-logo"}">
            <img src="${esc(c.image_url)}" alt="${esc(c.name)} ${c.image_is_photo ? "photo" : "logo"}">
            <figcaption>${c.image_is_photo ? "Photo" : "Logo"} from <a href="${esc(c.image_source || c.website)}" target="_blank" rel="noopener">the company's website</a></figcaption>
          </figure>` : ""}

        <section class="card stack">
          <div>
            <span class="small" style="color:${categoryColor(c.category)};font-weight:700">${esc(c.category)}</span>
            <h1>${c.website ? `<a href="${esc(c.website)}" target="_blank" rel="noopener">${esc(c.name)}</a>` : esc(c.name)}</h1>
            <p class="verified">✓ Details checked on the official website${c.checked_on ? ` on ${esc(c.checked_on)}` : ""}</p>
          </div>
          <div class="pills">
            <span class="pill ${status.tone}">${esc(status.text)}${many && branch ? ` (${esc(branch.name)})` : ""}</span>
            ${many ? `<span class="pill info">${c.branches.length} branches</span>` : ""}
            ${c.claim_status === "verified" ? `<span class="pill ok">Managed by the company on Co-op</span>` : ""}
          </div>
          ${status.note ? `<p class="notice">📣 ${esc(status.note)}</p>` : ""}
          ${c.description ? `<blockquote>${esc(c.description)}</blockquote>` : ""}
          ${c.items && c.items.length ? `<div><p class="label" style="margin-bottom:6px">${c.kind === "services" ? "Services" : "Materials"}</p>
            <div class="tags">${c.items.map(i => `<span>${esc(i)}</span>`).join("")}</div></div>` : ""}
          ${c.extra ? `<p class="muted">${esc(c.extra)}</p>` : ""}
        </section>

        <section class="card stack">
          <h2 class="subtitle">${many ? `Branches (${c.branches.length})` : "Location"}</h2>
          <div class="map" id="c-map" style="height:300px;border-radius:12px;overflow:hidden"></div>
          <div class="branch-list">${c.branches.map(b => branchItem(c, b)).join("")}</div>
        </section>

        <section class="card stack">
          <h2 class="subtitle">Reviews</h2>
          <div id="c-reviews" class="stack"><p class="muted">Loading…</p></div>
        </section>
      </div>

      <div class="stack">
        <section class="card stack">
          <button class="btn brand" type="button" id="c-request">Send a request</button>
          ${c.website ? `<a class="btn ghost small" href="${esc(c.website)}" target="_blank" rel="noopener">${esc(siteLabel(c.website))} ↗</a>` : ""}
          <dl class="facts">
            <dt>${c.kind === "services" ? "Lead" : "Who handles"}</dt><dd>${esc(c.contact || "Main line")}</dd>
            <dt>Email</dt><dd>${c.email ? `${esc(c.email)}<button class="copy" type="button" data-copy="${esc(c.email)}">copy</button>` : "Not published"}</dd>
            ${!many && branch ? `<dt>Phone</dt><dd>${phoneLines(branch.phones) || "Not published"}</dd><dt>Hours</dt><dd>${esc(branch.hours_text || "Not published")}</dd>` : ""}
            ${c.serves ? `<dt>Serves</dt><dd>${esc(c.serves)}</dd>` : ""}
            ${c.license ? `<dt>FL license</dt><dd>${esc(c.license)} · <a href="https://www.myfloridalicense.com/wl11.asp?mode=0&SID=" target="_blank" rel="noopener">check it ↗</a></dd>` : ""}
            ${c.founded ? `<dt>Founded</dt><dd>${esc(c.founded)}</dd>` : ""}
          </dl>
        </section>
        <section class="card stack">
          <h2 class="subtitle">On Co-op</h2>
          <div class="stats" id="c-stats"></div>
        </section>
        ${c.claim_status === "none" ? `<div class="card small">Work here? <a href="#/signup?role=contractor">Claim this company</a> to reply to requests and update your details.</div>` : ""}
      </div>
    </div>`;

  $("#c-request").addEventListener("click", () => openRequestForm(c));

  const map = createMap($("#c-map"), { onPickLocation() {}, onPickCompany() {} });
  map.show([{ company: c, number: 1, status }], null);

  function showStats() {
    const s = state.stats[c.id] || {};
    $("#c-stats").innerHTML = `
      <div class="stat"><b>${s.review_count ? "★ " + Number(s.avg_stars).toFixed(1) : "—"}</b><span>${s.review_count || 0} review${s.review_count === 1 ? "" : "s"}</span></div>
      <div class="stat"><b>${s.reply_count ? formatMinutes(s.median_reply_minutes) : "—"}</b><span>Typical reply time</span></div>
      <div class="stat"><b>${s.reply_count || 0}</b><span>Requests answered</span></div>`;
  }
  showStats();
  loadStats().then(() => { if ($("#c-stats")) showStats(); });

  if (!live) {
    $("#c-reviews").innerHTML = `<p class="muted">Reviews appear once the site is connected to its database.</p>`;
  } else {
    loadReviews(c.id).then(reviews => {
      if (!$("#c-reviews")) return; // left the page meanwhile
      $("#c-reviews").innerHTML = reviews.length
        ? reviews.map(r => `<div class="review"><span class="stars">${stars(r.stars)}</span> <span class="small muted">· Co-op client · ${timeAgo(r.created_at)}</span>${r.body ? `<p>${esc(r.body)}</p>` : ""}</div>`).join("")
        : `<p class="muted">No reviews yet. Clients can review ${esc(c.name)} after it replies to their request.</p>`;
    }).catch(err => { if ($("#c-reviews")) $("#c-reviews").innerHTML = `<p class="error">${esc(err.message)}</p>`; });
  }

  return () => map.destroy();
}
