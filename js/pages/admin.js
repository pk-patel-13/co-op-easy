// Admin: confirm or reject company claims and new listings.
// Only accounts with profiles.is_admin = true get data here; the database checks it too.

import { $, esc, toast } from "../lib/dom.js";
import { timeAgo } from "../lib/time.js";
import { state } from "../data/client.js";
import { loadCompanies } from "../data/directory.js";
import { pendingClaims, decideClaim } from "../data/admin.js";

function claimCard(c) {
  return `<div class="card stack">
    <div class="row between">
      <h2 class="subtitle">${esc(c.company_name)}</h2>
      <span class="pill ${c.is_new_listing ? "info" : "warn"}">${c.is_new_listing ? "New listing" : "Claim of an existing listing"}</span>
    </div>
    <dl class="facts small">
      <dt>Person</dt><dd>${esc(c.full_name)}</dd>
      <dt>Email</dt><dd>${esc(c.email || "")}</dd>
      <dt>Phone</dt><dd>${esc(c.phone || "")}</dd>
      <dt>Role / license</dt><dd>${esc(c.claim_note || "")}</dd>
      <dt>Website</dt><dd>${c.website ? `<a href="${esc(c.website)}" target="_blank" rel="noopener">${esc(c.website)}</a>` : "None"}</dd>
      <dt>Sent</dt><dd>${timeAgo(c.claimed_at)}</dd>
    </dl>
    <div class="row">
      <button class="btn brand small" data-decide="approve" data-company="${esc(c.company_id)}">Approve</button>
      <button class="btn ghost small" data-decide="reject" data-company="${esc(c.company_id)}">Reject</button>
    </div>
  </div>`;
}

export function renderAdmin(view) {
  if (!state.profile || !state.profile.is_admin) {
    view.innerHTML = `<div class="card auth"><p>This page is for Co-op admins.</p></div>`;
    return;
  }
  view.innerHTML = `<h1 class="title">Company claims to review</h1>
    <p class="muted" style="margin:6px 0 14px">Before approving, check the license on
      <a href="https://www.myfloridalicense.com/wl11.asp?mode=0&SID=" target="_blank" rel="noopener">MyFloridaLicense.com</a>
      or call the company's published phone number and ask for the person.</p>
    <div class="stack" id="ad-claims"><p class="muted">Loading…</p></div>`;

  async function load() {
    try {
      const claims = await pendingClaims();
      $("#ad-claims").innerHTML = claims.length ? claims.map(claimCard).join("") : `<p class="muted">Nothing waiting. 🎉</p>`;
    } catch (err) {
      $("#ad-claims").innerHTML = `<p class="error">${esc(err.message)}</p>`;
    }
  }

  $("#ad-claims").addEventListener("click", async e => {
    const b = e.target.closest("[data-decide]");
    if (!b) return;
    const approve = b.dataset.decide === "approve";
    try {
      await decideClaim(b.dataset.company, approve);
      toast(approve ? "Approved" : "Rejected");
      await loadCompanies();
      load();
    } catch (err) { toast(err.message); }
  });

  load();
}
