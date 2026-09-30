// Account (contractors): claim a company, then manage it.
//   no claim      -> claim form, or "my company isn't listed"
//   pending claim -> waiting message
//   verified      -> availability, incoming requests with client contacts, edit details

import { $, esc, toast } from "../../lib/dom.js";
import { formatMinutes, timeAgo, isToday } from "../../lib/time.js";
import { milesBetween } from "../../lib/places.js";
import { state, myId } from "../../data/client.js";
import { loadCompanies, loadStats, categoriesOf } from "../../data/directory.js";
import {
  claimCompany, submitCompany, releaseClaim, setCompanyStatus, updateMyCompany, incomingRequests, sendReply,
} from "../../data/contractor.js";
import { openDialog, closeDialog } from "../../components/dialog.js";
import { thumb } from "../../components/look.js";

const list = text => text.split(",").map(x => x.trim()).filter(Boolean);

export async function renderContractor(box) {
  const mine = state.companies.find(c => c.claimed_by === myId());
  if (!mine) return renderClaimForm(box);
  if (mine.claim_status !== "verified") return renderPending(box, mine);
  return renderDashboard(box, mine);
}

// ---------- 1. claim ----------

function renderClaimForm(box) {
  const free = state.companies.filter(c => c.claim_status === "none" && c.approved !== false)
    .sort((a, b) => a.name.localeCompare(b.name));

  box.innerHTML = `
    <h2 class="subtitle">Claim your company</h2>
    <p class="muted small">If your account email is on your company's website domain, you're verified right away.
      Otherwise Co-op checks your Florida license first.</p>
    <form id="cl-form" class="stack">
      <div class="field"><label for="cl-company">Your company</label>
        <select id="cl-company" class="input"><option value="">Choose…</option>
          ${free.map(c => `<option value="${esc(c.id)}">${esc(c.name)} (${esc(c.category)})</option>`).join("")}</select></div>
      <div class="grid2">
        <div class="field"><label for="cl-title">Your role</label><input id="cl-title" class="input" maxlength="60" placeholder="Owner, sales manager…"></div>
        <div class="field"><label for="cl-license">Florida license # (if any)</label><input id="cl-license" class="input" maxlength="30" placeholder="CGC1234567"></div>
      </div>
      <button class="btn brand" type="submit">Claim company</button>
    </form>
    <details>
      <summary>My company isn't listed</summary>
      <form id="nc-form" class="stack" style="margin-top:12px">
        <div class="grid2">
          <div class="field"><label for="nc-name">Company name</label><input id="nc-name" class="input" maxlength="120"></div>
          <div class="field"><label for="nc-kind">You offer</label><select id="nc-kind" class="input"><option value="services">Services / contracting</option><option value="materials">Materials / supplies</option></select></div>
          <div class="field"><label for="nc-cat">Category</label><input id="nc-cat" class="input" list="nc-cats" maxlength="60" placeholder="General Contractor"><datalist id="nc-cats">${categoriesOf().map(c => `<option value="${esc(c)}">`).join("")}</datalist></div>
          <div class="field"><label for="nc-phone">Business phone</label><input id="nc-phone" class="input" type="tel" maxlength="30"></div>
        </div>
        <div class="field"><label for="nc-address">Address</label><input id="nc-address" class="input" maxlength="200"></div>
        <div class="field"><label for="nc-site">Website</label><input id="nc-site" class="input" type="url" placeholder="https://" maxlength="200"></div>
        <div class="field"><label for="nc-desc">What you do</label><textarea id="nc-desc" class="input" maxlength="600"></textarea></div>
        <div class="grid2">
          <div class="field"><label for="nc-title">Your role</label><input id="nc-title" class="input" maxlength="60"></div>
          <div class="field"><label for="nc-license">Florida license #</label><input id="nc-license" class="input" maxlength="30"></div>
        </div>
        <button class="btn" type="submit">Send for review</button>
      </form>
    </details>`;

  $("#cl-form", box).addEventListener("submit", async e => {
    e.preventDefault();
    const id = $("#cl-company").value;
    const title = $("#cl-title").value.trim();
    if (!id) { toast("Choose your company first."); return; }
    if (!title) { toast("Please add your role at the company."); return; }
    try {
      const result = await claimCompany(id, `${title} · License ${$("#cl-license").value.trim() || "not given"}`);
      toast(result === "verified" ? "Verified! You can now reply to requests." : "Claim sent. We'll confirm it soon.");
      await loadCompanies();
      renderContractor(box);
    } catch (err) { toast(err.message); }
  });

  $("#nc-form", box).addEventListener("submit", async e => {
    e.preventDefault();
    if (!$("#nc-name").value.trim() || !$("#nc-cat").value.trim() || !$("#nc-title").value.trim()) {
      toast("Please fill in the company name, category and your role.");
      return;
    }
    try {
      await submitCompany({
        p_kind: $("#nc-kind").value, p_name: $("#nc-name").value.trim(), p_category: $("#nc-cat").value.trim(),
        p_address: $("#nc-address").value.trim(), p_phone: $("#nc-phone").value.trim(), p_website: $("#nc-site").value.trim(),
        p_description: $("#nc-desc").value.trim(),
        p_note: `${$("#nc-title").value.trim()} · License ${$("#nc-license").value.trim() || "not given"}`,
      });
      toast("Sent! Co-op will review your listing.");
      await loadCompanies();
      renderContractor(box);
    } catch (err) { toast(err.message); }
  });
}

// ---------- 2. pending ----------

function renderPending(box, company) {
  box.innerHTML = `
    <h2 class="subtitle">${esc(company.name)}</h2>
    <p class="notice">⏳ Waiting for Co-op to confirm you work at ${esc(company.name)}. We check your Florida license or call the company's published number.
      You'll see requests here as soon as it's confirmed.</p>
    <p class="small muted">Picked the wrong company? <button class="btn ghost small" id="cl-release">Cancel my claim</button></p>`;
  $("#cl-release", box).addEventListener("click", async () => {
    try { await releaseClaim(); toast("Claim cancelled"); await loadCompanies(); renderContractor(box); }
    catch (err) { toast(err.message); }
  });
}

// ---------- 3. verified dashboard ----------

function closestBranchMiles(request, company) {
  const withCoords = company.branches.filter(b => b.lat != null);
  if (request.lat == null || !withCoords.length) return null;
  return Math.min(...withCoords.map(b => milesBetween(request, b)));
}

function incomingCard(r, company) {
  const mine = (r.replies || []).find(rep => rep.company_id === company.id);
  const client = r.client;
  const miles = closestBranchMiles(r, company);
  const label = r.status !== "open" ? r.status : mine ? "You replied" : r.company_id ? "Sent to you" : `Open to all ${r.category}`;
  return `<div class="request" data-request-id="${esc(r.id)}">
    <div class="row between"><h4>${esc(r.need)}</h4><span class="pill ${r.status !== "open" ? "" : mine ? "ok" : "warn"}">${esc(label)}</span></div>
    ${r.details ? `<p class="small">${esc(r.details)}</p>` : ""}
    <p class="small muted">${esc(r.when_text || "")} · ZIP ${esc(r.zip || "")}${miles != null ? ` · ${miles.toFixed(1)} mi from your nearest branch` : ""} · ${timeAgo(r.created_at)}</p>
    ${client ? `<div class="reply small">
        <b>${esc(client.full_name)}${client.business_name ? " · " + esc(client.business_name) : ""}</b>
        <span>${client.phone ? `${esc(client.phone)}<button class="copy" type="button" data-copy="${esc(client.phone)}">copy</button>` : ""}
          ${client.email ? ` · ${esc(client.email)}<button class="copy" type="button" data-copy="${esc(client.email)}">copy</button>` : ""}</span>
        <span class="muted">${client.client_type === "business" ? "Construction firm / business" : "Homeowner"}</span>
      </div>` : ""}
    ${mine ? `<div class="reply small"><b>Your reply</b><span>${esc(mine.message)}</span>
        <span class="muted">${mine.price ? "Estimate: " + esc(mine.price) + " · " : ""}${mine.eta ? "Start: " + esc(mine.eta) + " · " : ""}${timeAgo(mine.created_at)}</span></div>`
      : r.status === "open" ? `<button class="btn brand small" data-reply="${esc(r.id)}">Reply</button>` : ""}
  </div>`;
}

async function renderDashboard(box, company) {
  await loadStats();
  const st = state.stats[company.id] || {};
  let requests = [];
  try { requests = await incomingRequests(); } catch (err) { toast(err.message); }
  const openCount = requests.filter(r => r.status === "open").length;
  const current = isToday(company.status_at) ? company.status : null;

  box.innerHTML = `
    <div class="row between">
      <div class="row">${thumb(company)}<div><h2 class="subtitle">${esc(company.name)}</h2>
        <a class="small" href="#/company/${esc(company.id)}">See your public page</a></div></div>
      <span class="pill ok">✓ Verified manager</span>
    </div>

    <div class="stats">
      <div class="stat"><b>${openCount}</b><span>Open requests</span></div>
      <div class="stat"><b>${st.reply_count ? formatMinutes(st.median_reply_minutes) : "—"}</b><span>Your typical reply time</span></div>
      <div class="stat"><b>${st.review_count ? "★ " + Number(st.avg_stars).toFixed(1) : "—"}</b><span>${st.review_count || 0} reviews</span></div>
    </div>

    <div class="stack">
      <span class="label">Right now you are</span>
      <div class="row" id="db-status">
        ${[["available", "✅ Available"], ["busy", "⏳ Busy"], ["closed", "⛔ Closed today"]].map(([key, text]) =>
          `<button type="button" class="toggle" data-status="${key}" aria-pressed="${current === key}">${text}</button>`).join("")}
      </div>
      <input id="db-note" class="input" maxlength="140" placeholder="Note for clients, e.g. Same-day delivery before noon" value="${esc(company.status_note || "")}">
      <p class="hint">Clients see this for 24 hours, then your normal opening hours show again.</p>
    </div>

    <h3 class="subtitle">Requests for you</h3>
    <div class="stack" id="db-incoming">
      ${requests.length ? requests.map(r => incomingCard(r, company)).join("")
        : `<p class="muted">No requests yet. New ones for ${esc(company.category)} appear here right away.</p>`}
    </div>

    <details>
      <summary>Edit your public details</summary>
      <form id="db-details" class="stack" style="margin-top:12px">
        <div class="field"><label for="d-desc">About your company</label><textarea id="d-desc" class="input" maxlength="600">${esc(company.description || "")}</textarea></div>
        <div class="grid2">
          <div class="field"><label for="d-email">Public email</label><input id="d-email" class="input" type="email" value="${esc(company.email || "")}"></div>
          <div class="field"><label for="d-contact">Who handles requests</label><input id="d-contact" class="input" value="${esc(company.contact || "")}" maxlength="200"></div>
        </div>
        <div class="field"><label for="d-items">${company.kind === "services" ? "Services" : "Materials"} (comma separated)</label><textarea id="d-items" class="input">${esc((company.items || []).join(", "))}</textarea></div>
        <div class="field"><label for="d-serves">Who you serve</label><input id="d-serves" class="input" value="${esc(company.serves || "")}" maxlength="200"></div>
        <p class="hint">Branch addresses, phones and hours: email Co-op support to change them.</p>
        <button class="btn" type="submit">Save details</button>
      </form>
    </details>`;

  $("#db-status", box).addEventListener("click", async e => {
    const b = e.target.closest("[data-status]");
    if (!b) return;
    try { await setCompanyStatus(b.dataset.status, $("#db-note").value.trim()); toast("Updated. Clients see it now."); await loadCompanies(); renderContractor(box); }
    catch (err) { toast(err.message); }
  });

  $("#db-incoming", box).addEventListener("click", e => {
    const b = e.target.closest("[data-reply]");
    if (b) openReplyForm(requests.find(r => r.id === b.dataset.reply), company, () => renderContractor(box));
  });

  $("#db-details", box).addEventListener("submit", async e => {
    e.preventDefault();
    try {
      await updateMyCompany({
        p_description: $("#d-desc").value.trim(), p_email: $("#d-email").value.trim() || null,
        p_contact: $("#d-contact").value.trim(), p_items: list($("#d-items").value), p_serves: $("#d-serves").value.trim() || null,
      });
      toast("Details saved");
      await loadCompanies();
    } catch (err) { toast(err.message); }
  });
}

function openReplyForm(request, company, done) {
  const dialog = openDialog(`
    <form id="rp-form">
      <h2>Reply to “${esc(request.need)}”</h2>
      <div class="field"><label for="rp-msg">Message</label>
        <textarea id="rp-msg" class="input" maxlength="1000" placeholder="Yes, we can help. Here's what we'd do…"></textarea></div>
      <div class="grid2">
        <div class="field"><label for="rp-price">Price estimate (optional)</label><input id="rp-price" class="input" maxlength="80" placeholder="$1,200"></div>
        <div class="field"><label for="rp-eta">Can start or deliver</label><input id="rp-eta" class="input" maxlength="80" placeholder="Tomorrow 8 AM"></div>
      </div>
      <div class="row"><button class="btn brand" type="submit">Send reply</button><button class="btn ghost" type="button" data-close>Cancel</button></div>
    </form>`);
  $("#rp-form", dialog).addEventListener("submit", async e => {
    e.preventDefault();
    const message = $("#rp-msg").value.trim();
    if (!message) { toast("Please write a message."); return; }
    try {
      await sendReply({
        request_id: request.id, company_id: company.id, message,
        price: $("#rp-price").value.trim() || null, eta: $("#rp-eta").value.trim() || null,
      });
      closeDialog();
      toast("Reply sent");
      done();
    } catch (err) { toast(err.message); }
  });
}
