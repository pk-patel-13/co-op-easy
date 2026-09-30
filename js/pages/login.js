// Sign-in and "forgot password".

import { $, toast } from "../lib/dom.js";
import { live, state } from "../data/client.js";
import { signIn, sendPasswordReset } from "../data/account.js";
import { previewOnly, goNext } from "./signup.js";

export function renderLogin(view) {
  if (!live) return previewOnly(view);
  if (state.session) { location.hash = "#/account"; return; }

  view.innerHTML = `
    <form class="card auth stack" id="login">
      <h1 class="title">Sign in</h1>
      <div class="field"><label for="li-email">Email</label><input id="li-email" class="input" type="email" autocomplete="email" required></div>
      <div class="field"><label for="li-pass">Password</label><input id="li-pass" class="input" type="password" autocomplete="current-password" required></div>
      <p class="error" id="li-error" hidden></p>
      <button class="btn brand" type="submit">Sign in</button>
      <div class="row between small">
        <a href="#/signup">Create an account</a>
        <button type="button" class="btn ghost small" id="li-forgot">Forgot password?</button>
      </div>
    </form>`;

  const showError = message => { $("#li-error").textContent = message; $("#li-error").hidden = false; };

  $("#login").addEventListener("submit", async event => {
    event.preventDefault();
    try {
      await signIn($("#li-email").value.trim(), $("#li-pass").value);
      goNext();
    } catch (err) {
      showError(err.message === "Invalid login credentials" ? "Wrong email or password." : err.message);
    }
  });

  $("#li-forgot").addEventListener("click", async () => {
    const email = $("#li-email").value.trim();
    if (!email) return showError("Type your email first, then tap Forgot password.");
    try { await sendPasswordReset(email); toast("Password reset link sent. Check your email."); }
    catch (err) { showError(err.message); }
  });
}
