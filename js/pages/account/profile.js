// Account: the person's own details, editable, and sign out.

import { $, esc, toast } from "../../lib/dom.js";
import { state } from "../../data/client.js";
import { updateProfile, signOut } from "../../data/account.js";
import { renderNav } from "../../components/nav.js";

function accountType(p) {
  if (p.role === "contractor") return "Contractor / supplier account";
  return p.client_type === "business" ? "Construction firm / business" : "Homeowner";
}

export function renderProfile(box) {
  const p = state.profile;
  box.innerHTML = `
    <div>
      <h1 class="subtitle">${esc(p.full_name)}</h1>
      <p class="muted small">${accountType(p)}</p>
    </div>
    <dl class="facts small">
      <dt>Email</dt><dd>${esc(p.email || state.session.user.email)}</dd>
      <dt>Phone</dt><dd>${esc(p.phone || "Not set")}</dd>
      <dt>ZIP</dt><dd>${esc(p.zip || "Not set")}</dd>
      ${p.business_name ? `<dt>Business</dt><dd>${esc(p.business_name)}</dd>` : ""}
    </dl>
    <details>
      <summary class="small">Edit my details</summary>
      <form id="pf-form" class="stack" style="margin-top:10px">
        <div class="field"><label for="pf-name">Full name</label><input id="pf-name" class="input" value="${esc(p.full_name)}" maxlength="80"></div>
        <div class="field"><label for="pf-phone">Phone</label><input id="pf-phone" class="input" type="tel" value="${esc(p.phone || "")}" maxlength="30"></div>
        <div class="field"><label for="pf-zip">ZIP</label><input id="pf-zip" class="input" inputmode="numeric" maxlength="5" value="${esc(p.zip || "")}"></div>
        ${p.role === "client" ? `<div class="field"><label for="pf-biz">Business name (leave empty if you're a homeowner)</label><input id="pf-biz" class="input" value="${esc(p.business_name || "")}" maxlength="120"></div>` : ""}
        <button class="btn small" type="submit">Save</button>
      </form>
    </details>
    <div class="row">
      ${p.is_admin ? `<a class="btn small" href="#/admin">Admin: review claims</a>` : ""}
      <button class="btn ghost small" id="pf-out">Sign out</button>
    </div>`;

  $("#pf-form", box).addEventListener("submit", async e => {
    e.preventDefault();
    const name = $("#pf-name").value.trim();
    const zip = $("#pf-zip").value.trim();
    if (name.length < 2) { toast("Please enter your full name."); return; }
    if (zip && !state.zips[zip]) { toast("Please enter a Florida ZIP code."); return; }
    const changes = { full_name: name, phone: $("#pf-phone").value.trim() || null, zip: zip || null };
    if ($("#pf-biz")) {
      changes.business_name = $("#pf-biz").value.trim() || null;
      changes.client_type = changes.business_name ? "business" : "homeowner";
    }
    try { await updateProfile(changes); toast("Saved"); renderProfile(box); renderNav(); }
    catch (err) { toast(err.message); }
  });

  $("#pf-out", box).addEventListener("click", async () => { await signOut(); renderNav(); location.hash = "#/"; });
}
