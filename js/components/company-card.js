// One company in the find list.

import { esc } from "../lib/dom.js";
import { formatMinutes } from "../lib/time.js";
import { siteLabel } from "../lib/places.js";
import { categoryColor, thumb } from "./look.js";

// row: { company, branch, status, miles, stats, number }
export function companyCard({ company: c, branch, status, miles, stats, number }) {
  const pills = [`<span class="pill ${status.tone}">${esc(status.text)}</span>`];
  pills.push(stats.review_count
    ? `<span class="pill warn">★ ${Number(stats.avg_stars).toFixed(1)} · ${stats.review_count} review${stats.review_count > 1 ? "s" : ""}</span>`
    : `<span class="pill">No reviews yet</span>`);
  if (stats.reply_count) pills.push(`<span class="pill info">⚡ Replies in ~${formatMinutes(stats.median_reply_minutes)}</span>`);
  if (c.branches.length > 1) pills.push(`<span class="pill info">${c.branches.length} branches</span>`);
  if (c.claim_status === "verified") pills.push(`<span class="pill ok">On Co-op</span>`);

  const branchLine = c.branches.length > 1 && branch ? `<span class="small muted">Nearest: ${esc(branch.name)}</span>` : "";
  const phone = branch && branch.phones && branch.phones[0];

  return `<article class="card company-card ${status.available ? "" : "closed"}" data-company="${esc(c.id)}">
    <div class="company-head">
      ${thumb(c, number)}
      <div>
        <h3><a href="#/company/${esc(c.id)}">${esc(c.name)}</a></h3>
        <div class="meta">
          <span class="small" style="color:${categoryColor(c.category)};font-weight:700">${esc(c.category)}</span>
          <span class="verified" title="Details checked on the company's official website">✓ Verified</span>
          ${c.website ? `<a class="site-link" href="${esc(c.website)}" target="_blank" rel="noopener">${esc(siteLabel(c.website))} ↗</a>` : ""}
        </div>
        ${branchLine}
      </div>
      <div class="distance">${miles != null ? miles.toFixed(1) + " mi" : ""}<small>${miles != null ? "away" : branch && branch.lat == null ? "no address" : ""}</small></div>
    </div>
    <div class="pills">${pills.join("")}</div>
    ${status.note ? `<p class="small">📣 ${esc(status.note)}</p>` : ""}
    <div class="row">
      <button type="button" class="btn brand small" data-request="${esc(c.id)}">Send request</button>
      <a class="btn ghost small" href="#/company/${esc(c.id)}">Details & contact</a>
      <button type="button" class="btn ghost small" data-show-on-map="${esc(c.id)}">Show on map</button>
      ${phone ? `<span class="small muted">${esc(phone)}</span>` : ""}
    </div>
  </article>`;
}
