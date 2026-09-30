// Sign-up: real details for clients (homeowners, firms) and contractors.

import { $, esc, toast, saved } from "../lib/dom.js";
import { live, state } from "../data/client.js";
import { signUp } from "../data/account.js";

export function previewOnly(view) {
  view.innerHTML = `<div class="card auth stack"><h1 class="title">Accounts are coming soon</h1>
    <p class="muted">This copy of Co-op isn't connected to its database yet, so sign-up is off. You can still browse every company.</p>
    <p><a class="btn" href="#/find/services">Browse contractors</a></p></div>`;
}

// After signing up or in, go back to where the person was (e.g. a company page).
export function goNext() {
  const next = saved.get("next");
  saved.set("next", null);
  location.hash = next || "#/account";
}

// Returns a list of problems, empty when the form is fine.
function signupProblems({ fullName, phone, zip, emailValid, password }, zips) {
  const problems = [];
  if (fullName.trim().length < 2) problems.push("your full name");
  if (phone.replace(/\D/g, "").length < 10) problems.push("a 10-digit phone number");
  if (!zips[zip]) problems.push("a Florida ZIP code");
  if (!emailValid) problems.push("a valid email");
  if (password.length < 8) problems.push("a password of 8+ characters");
  return problems;
}

export function renderSignup(view, query) {
  if (!live) return previewOnly(view);
  if (state.session) { location.hash = "#/account"; return; }
  const asContractor = query.get("role") === "contractor";

  view.innerHTML = `
    <form class="card auth stack" id="signup" novalidate>
      <h1 class="title">Join Co-op, free</h1>
      <div class="role-pick" role="radiogroup" aria-label="I am">
        <label><input type="radio" name="role" value="client" ${asContractor ? "" : "checked"}><b>I need work or materials</b><span class="small muted">Homeowner or construction firm</span></label>
        <label><input type="radio" name="role" value="contractor" ${asContractor ? "checked" : ""}><b>I'm a contractor or supplier</b><span class="small muted">Get requests from clients</span></label>
      </div>

      <div class="field"><label for="su-name">Full name</label><input id="su-name" class="input" autocomplete="name" maxlength="80"></div>
      <div class="grid2">
        <div class="field"><label for="su-phone">Mobile phone</label><input id="su-phone" class="input" type="tel" autocomplete="tel" maxlength="30" placeholder="305-555-0123"></div>
        <div class="field"><label for="su-zip">ZIP code</label><input id="su-zip" class="input" inputmode="numeric" maxlength="5" autocomplete="postal-code" placeholder="33130"></div>
      </div>

      <div id="su-client" class="stack">
        <div class="field"><label for="su-type">You are</label>
          <select id="su-type" class="input"><option value="homeowner">A homeowner</option><option value="business">A construction firm or business</option></select></div>
        <div class="field" id="su-biz-field" hidden><label for="su-biz">Business name</label><input id="su-biz" class="input" maxlength="120" autocomplete="organization"></div>
      </div>

      <div class="field"><label for="su-email">Email</label><input id="su-email" class="input" type="email" autocomplete="email">
        <span class="hint" id="su-email-hint"></span></div>
      <div class="field"><label for="su-pass">Password</label><input id="su-pass" class="input" type="password" autocomplete="new-password">
        <span class="hint">At least 8 characters.</span></div>

      <p class="error" id="su-error" hidden></p>
      <button class="btn brand" type="submit">Create account</button>
      <p class="small muted">Already have an account? <a href="#/login">Sign in</a></p>
    </form>`;

  const form = $("#signup");
  const role = () => form.querySelector("input[name=role]:checked").value;
  function syncRole() {
    const contractor = role() === "contractor";
    $("#su-client").hidden = contractor;
    $("#su-email-hint").textContent = contractor
      ? "Tip: use your work email on your company's website domain (like you@delsolroofing.com) to be verified instantly."
      : "We'll send a link to confirm it's you.";
  }
  form.addEventListener("change", e => {
    if (e.target.name === "role") syncRole();
    if (e.target.id === "su-type") $("#su-biz-field").hidden = e.target.value !== "business";
  });
  syncRole();

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const error = $("#su-error");
    const email = $("#su-email").value.trim();
    const zip = $("#su-zip").value.trim();
    const problems = signupProblems({
      fullName: $("#su-name").value, phone: $("#su-phone").value, zip,
      emailValid: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), password: $("#su-pass").value,
    }, state.zips);
    if (problems.length) { error.textContent = "Please add " + problems.join(", ") + "."; error.hidden = false; return; }

    const isClient = role() === "client";
    const isBusiness = isClient && $("#su-type").value === "business";
    try {
      const result = await signUp({
        email,
        password: $("#su-pass").value,
        role: role(),
        full_name: $("#su-name").value.trim(),
        phone: $("#su-phone").value.trim(),
        zip,
        client_type: isClient ? $("#su-type").value : null,
        business_name: isBusiness ? $("#su-biz").value.trim() : null,
      });
      if (result.needsEmailConfirm) {
        view.innerHTML = `<div class="card auth stack"><h1 class="title">Check your email</h1>
          <p>We sent a confirmation link to <b>${esc(email)}</b>. Open it on this device to finish signing up.</p>
          <p class="muted small">Nothing after a few minutes? Check spam, or <a href="#/login">sign in</a> to try again.</p></div>`;
      } else {
        toast("Welcome to Co-op!");
        goNext();
      }
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  });
}
