// Small visual pieces: category colors, company thumbnails, stars.

import { esc } from "../lib/dom.js";

let categoryOrder = [];

// Call once after companies load, so every category keeps the same color everywhere.
export function setCategories(list) { categoryOrder = list; }

export function categoryColor(category) {
  const i = Math.max(0, categoryOrder.indexOf(category));
  return `var(--c${(i % 8) + 1})`;
}

function initials(name) {
  return name.replace(/[^A-Za-z ]/g, "").split(" ").filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
}

// Logo, photo, or colored initials. number = the list number shown in the corner.
export function thumb(company, number) {
  const num = number ? `<span class="num" style="background:${categoryColor(company.category)}">${number}</span>` : "";
  if (company.image_url) {
    return `<div class="thumb ${company.image_is_photo ? "photo" : ""}"><img src="${esc(company.image_url)}" alt="" loading="lazy">${num}</div>`;
  }
  return `<div class="thumb" style="background:${categoryColor(company.category)}"><span class="initials">${esc(initials(company.name))}</span>${num}</div>`;
}

export function stars(n) {
  const full = Math.max(0, Math.min(5, Math.round(n)));
  return "★".repeat(full) + "☆".repeat(5 - full);
}
