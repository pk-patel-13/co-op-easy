// Home page: what Co-op is, and the two ways in.

import { esc } from "../lib/dom.js";
import { state } from "../data/client.js";
import { categoriesOf } from "../data/directory.js";

export function renderHome(view) {
  const tiles = state.companies.filter(c => c.image_url).slice(0, 9);
  const count = kind => state.companies.filter(c => c.kind === kind).length;
  const chips = kind => categoriesOf(kind).map(c => `<span class="chip">${esc(c)}</span>`).join("");

  view.innerHTML = `
    <section class="hero">
      <div>
        <h1>Builders and suppliers <em>near you</em>, open right now.</h1>
        <p>Co-op connects homeowners and construction firms in Miami with contractors and material yards.
           See who's open, who replies fast and who gets good reviews, then send one request.</p>
        <div class="row">
          <a class="btn brand" href="#/find/services">Find a contractor</a>
          <a class="btn ghost" href="#/find/materials">Buy materials</a>
        </div>
      </div>
      <div class="hero-art" aria-hidden="true">
        ${tiles.map(c => `<div class="tile ${c.image_is_photo ? "photo" : ""}"><img src="${esc(c.image_url)}" alt=""></div>`).join("")}
      </div>
    </section>

    <section class="choices">
      <a class="choice" href="#/find/services">
        <span class="emoji" aria-hidden="true">🛠</span>
        <h2>I need work done</h2>
        <p class="muted">${count("services")} contractors: remodeling, roofing, concrete, permits.</p>
        <div class="row">${chips("services")}</div>
      </a>
      <a class="choice" href="#/find/materials">
        <span class="emoji" aria-hidden="true">🧱</span>
        <h2>I need materials</h2>
        <p class="muted">${count("materials")} suppliers: lumber, block, concrete, drywall, roofing, electrical, plumbing.</p>
        <div class="row">${chips("materials")}</div>
      </a>
    </section>

    <section class="how" id="how">
      <div class="card">
        <h2>For homeowners and builders</h2>
        <ol>
          <li>Pick a service or material and set your ZIP code.</li>
          <li>Sort by nearest open, fastest reply or best reviews.</li>
          <li>Send a request. Companies reply with a price and a start date.</li>
          <li>When the job's done, leave a review to help your neighbors.</li>
        </ol>
        <a class="btn brand small" href="#/signup">Join free</a>
      </div>
      <div class="card">
        <h2>For contractors and suppliers</h2>
        <ol>
          <li>Sign up with your work email and claim your company.</li>
          <li>An email on your company's website domain verifies you instantly. Otherwise Co-op checks your Florida license.</li>
          <li>Mark yourself available and get requests from people nearby.</li>
          <li>Fast replies and good reviews move you up the list.</li>
        </ol>
        <a class="btn small" href="#/signup?role=contractor">List your company</a>
      </div>
    </section>`;
}
