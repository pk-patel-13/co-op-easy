// The account link in the header: "Sign in / Join free" or "Maria's account".

import { $, esc } from "../lib/dom.js";
import { live, state } from "../data/client.js";

export function renderNav() {
  const slot = $("#nav-account");
  if (state.session && state.profile) {
    const first = state.profile.full_name.split(" ")[0];
    slot.innerHTML = `<a class="btn small" href="#/account">${esc(first)}'s account</a>`;
  } else if (live) {
    slot.innerHTML = `<a href="#/login">Sign in</a> <a class="btn small brand" href="#/signup">Join free</a>`;
  } else {
    slot.innerHTML = "";
  }
}
