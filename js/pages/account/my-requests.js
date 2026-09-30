// Account: a client's requests, the replies from companies, and reviews.

import { $, $$, esc, toast } from "../../lib/dom.js";
import { timeAgo } from "../../lib/time.js";
import { companyById } from "../../data/directory.js";
import { myRequests, setRequestStatus, postReview } from "../../data/requests.js";
import { openDialog, closeDialog } from "../../components/dialog.js";
import { stars } from "../../components/look.js";

const nameOf = id => (companyById(id) || {}).name || "a company";

function statusPill(r) {
  const n = (r.replies || []).length;
  if (r.status === "done") return `<span class="pill ok">Done</span>`;
  if (r.status === "cancelled") return `<span class="pill">Cancelled</span>`;
  if (n) return `<span class="pill info">${n} repl${n > 1 ? "ies" : "y"}</span>`;
  return `<span class="pill warn">Waiting for replies</span>`;
}

function replyBox(rep) {
  const company = companyById(rep.company_id);
  const phone = company && company.branches[0] && company.branches[0].phones[0];
  return `<div class="reply">
    <b><a href="#/company/${esc(rep.company_id)}">${esc(nameOf(rep.company_id))}</a></b>
    <span>${esc(rep.message)}</span>
    <span class="small muted">${rep.price ? "Estimate: " + esc(rep.price) + " · " : ""}${rep.eta ? "Can start: " + esc(rep.eta) + " · " : ""}replied ${timeAgo(rep.created_at)}</span>
    ${phone ? `<span class="small">Call ${esc(phone)}</span>` : ""}
  </div>`;
}

function requestCard(r) {
  const to = r.company_id ? nameOf(r.company_id) : `all ${r.category} companies`;
  const replies = r.replies || [];
  return `<div class="request" data-request-id="${esc(r.id)}">
    <div class="row between"><h4>${esc(r.need)}</h4>${statusPill(r)}</div>
    <p class="small muted">To ${esc(to)} · ${esc(r.when_text || "")} · ZIP ${esc(r.zip || "")} · sent ${timeAgo(r.created_at)}</p>
    ${r.details ? `<p class="small">${esc(r.details)}</p>` : ""}
    ${replies.map(replyBox).join("")}
    ${r.review ? `<p class="small">You rated ${esc(nameOf(r.review.company_id))} <span class="stars">${stars(r.review.stars)}</span></p>` : ""}
    <div class="row">
      ${r.status === "open" && replies.length ? `<button class="btn brand small" data-review="${esc(r.id)}">Job done? Leave a review</button>` : ""}
      ${r.status === "open" ? `<button class="btn ghost small" data-cancel="${esc(r.id)}">Cancel request</button>` : ""}
    </div>
  </div>`;
}

export async function renderMyRequests(box, { hideWhenEmpty = false } = {}) {
  let list;
  try { list = await myRequests(); } catch (err) { box.innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
  box.hidden = hideWhenEmpty && !list.length;
  box.innerHTML = `
    <div class="row between"><h2 class="subtitle">My requests</h2><a class="btn brand small" href="#/find/services">New request</a></div>
    ${list.length ? list.map(requestCard).join("")
      : `<p class="muted">No requests yet. Find a contractor or supplier and tap <b>Send request</b>. Replies show up here.</p>`}`;

  box.onclick = async e => {
    const review = e.target.closest("[data-review]");
    if (review) { openReview(list.find(r => r.id === review.dataset.review), () => renderMyRequests(box, { hideWhenEmpty })); return; }
    const cancel = e.target.closest("[data-cancel]");
    if (!cancel) return;
    if (cancel.dataset.sure !== "yes") { cancel.dataset.sure = "yes"; cancel.textContent = "Tap again to cancel"; return; }
    try { await setRequestStatus(cancel.dataset.cancel, "cancelled"); toast("Request cancelled"); renderMyRequests(box, { hideWhenEmpty }); }
    catch (err) { toast(err.message); }
  };
}

function openReview(request, done) {
  let rating = 5;
  const replied = [...new Set((request.replies || []).map(rep => rep.company_id))];
  const dialog = openDialog(`
    <form id="rv-form">
      <h2>How did it go?</h2>
      <div class="field"><label for="rv-company">Who did the job?</label>
        <select id="rv-company" class="input">${replied.map(id => `<option value="${esc(id)}">${esc(nameOf(id))}</option>`).join("")}</select></div>
      <div class="field"><span class="label">Rating</span>
        <div class="star-input" id="rv-stars">${[1, 2, 3, 4, 5].map(n => `<button type="button" class="on" data-n="${n}" aria-label="${n} star${n > 1 ? "s" : ""}">★</button>`).join("")}</div></div>
      <div class="field"><label for="rv-body">Your review (optional)</label><textarea id="rv-body" class="input" maxlength="600" placeholder="On time? Fair price? Clean work?"></textarea></div>
      <p class="hint">Reviews are public and shown as "Co-op client", without your name.</p>
      <div class="row"><button class="btn brand" type="submit">Post review</button><button class="btn ghost" type="button" data-close>Cancel</button></div>
    </form>`);

  $("#rv-stars", dialog).addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    rating = Number(b.dataset.n);
    $$("#rv-stars button", dialog).forEach(x => x.classList.toggle("on", Number(x.dataset.n) <= rating));
  });

  $("#rv-form", dialog).addEventListener("submit", async e => {
    e.preventDefault();
    try {
      await postReview({ request_id: request.id, company_id: $("#rv-company").value, stars: rating, body: $("#rv-body").value.trim() || null });
      await setRequestStatus(request.id, "done");
      closeDialog();
      toast("Thanks! Your review is posted.");
      done();
    } catch (err) { toast(err.message); }
  });
}
