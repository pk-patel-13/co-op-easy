// "My account" page frame. The parts live next to this file:
//   profile.js      name, phone, ZIP, sign out
//   my-requests.js  a client's requests, replies, reviews
//   contractor.js   claim a company, availability, incoming requests, company details

import { $ } from "../../lib/dom.js";
import { live, state } from "../../data/client.js";
import { loadCompanies } from "../../data/directory.js";
import { signOut } from "../../data/account.js";
import { watchChanges } from "../../data/live.js";
import { renderNav } from "../../components/nav.js";
import { renderProfile } from "./profile.js";
import { renderMyRequests } from "./my-requests.js";
import { renderContractor } from "./contractor.js";

export function renderAccount(view) {
  if (!live) {
    view.innerHTML = `<div class="card auth"><p>Accounts are off in preview mode. See the README to connect the database.</p></div>`;
    return;
  }
  if (!state.session) { location.hash = "#/login"; return; }
  if (!state.profile) {
    view.innerHTML = `<div class="card auth stack"><p>Setting up your account… If this stays here, sign out and in again.</p>
      <button class="btn ghost small" id="acc-out">Sign out</button></div>`;
    $("#acc-out").addEventListener("click", async () => { await signOut(); renderNav(); location.hash = "#/"; });
    return;
  }

  const isContractor = state.profile.role === "contractor";
  view.innerHTML = `
    <div class="account">
      <aside class="card stack" id="acc-profile"></aside>
      <div class="stack">
        ${isContractor ? `<section class="card stack" id="acc-company"><p class="muted">Loading your company…</p></section>` : ""}
        <section class="card stack" id="acc-requests"><p class="muted">Loading your requests…</p></section>
      </div>
    </div>`;

  renderProfile($("#acc-profile"));

  let busy = false;
  async function refresh() {
    if (busy || !$("#acc-requests")) return;
    busy = true;
    try {
      await loadCompanies();
      if (isContractor) await renderContractor($("#acc-company"));
      await renderMyRequests($("#acc-requests"), { hideWhenEmpty: isContractor });
    } finally { busy = false; }
  }
  refresh();

  // Live updates: new requests, replies, status changes (grouped, at most every 0.6 s).
  let timer = null;
  const stop = watchChanges(() => { clearTimeout(timer); timer = setTimeout(refresh, 600); });
  return () => { clearTimeout(timer); stop(); };
}
