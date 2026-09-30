// "Send a request" form, opened from the find page and company pages.

import { $, esc, toast, saved } from "../lib/dom.js";
import { live, state } from "../data/client.js";
import { sendRequest } from "../data/requests.js";
import { openDialog, closeDialog } from "./dialog.js";
import { myLocation } from "./location.js";

// Send visitors without an account to sign-up, then bring them back.
function requireAccount(returnTo) {
  if (!live) { toast("Accounts are off in preview mode."); return false; }
  if (!state.session) {
    saved.set("next", returnTo);
    location.hash = "#/signup";
    toast("Create a free account (or sign in) to send requests.");
    return false;
  }
  return true;
}

export function openRequestForm(company) {
  if (!requireAccount(`#/company/${company.id}`)) return;
  const here = myLocation();
  const zip = (state.profile && state.profile.zip) || (here && here.zip) || "";
  const example = company.kind === "services" ? "e.g. Quote to re-roof a 2,000 sq ft tile roof" : 'e.g. 40 sheets of 1/2" drywall, delivered';

  const dialog = openDialog(`
    <form id="request-form">
      <h2>Request from ${esc(company.name)}</h2>
      <div class="field"><label for="rq-need">What do you need?</label>
        <input id="rq-need" class="input" maxlength="120" placeholder="${esc(example)}"></div>
      <div class="field"><label for="rq-details">Details</label>
        <textarea id="rq-details" class="input" maxlength="1000" placeholder="Sizes, quantities, the job's area…"></textarea></div>
      <div class="grid2">
        <div class="field"><label for="rq-when">When?</label>
          <select id="rq-when" class="input">
            <option>As soon as possible</option><option>This week</option><option>This month</option><option>Just getting prices</option>
          </select></div>
        <div class="field"><label for="rq-zip">Job ZIP code</label>
          <input id="rq-zip" class="input" inputmode="numeric" maxlength="5" value="${esc(zip)}"></div>
      </div>
      <label class="row small"><input type="checkbox" id="rq-all"> Also send to other ${esc(company.category)} companies</label>
      <p class="notice small">Your name, phone and email go to the companies that get this request, so they can contact you.</p>
      <p class="error" id="rq-error" hidden></p>
      <div class="row">
        <button class="btn brand" type="submit">Send request</button>
        <button class="btn ghost" type="button" data-close>Cancel</button>
      </div>
    </form>`);

  const showError = message => { $("#rq-error").textContent = message; $("#rq-error").hidden = false; };

  $("#request-form", dialog).addEventListener("submit", async event => {
    event.preventDefault();
    const need = $("#rq-need").value.trim();
    const zipCode = $("#rq-zip").value.trim();
    const point = state.zips[zipCode];
    if (need.length < 3) return showError("Please say what you need (at least 3 letters).");
    if (!point) return showError("Please enter a Florida ZIP code.");
    try {
      await sendRequest({
        company_id: $("#rq-all").checked ? null : company.id,
        kind: company.kind,
        category: company.category,
        need,
        details: $("#rq-details").value.trim() || null,
        when_text: $("#rq-when").value,
        zip: zipCode,
        lat: point[0],
        lng: point[1],
      });
      closeDialog();
      toast("Request sent. Replies will show in your account.");
      location.hash = "#/account";
    } catch (err) {
      showError(err.message);
    }
  });
}
