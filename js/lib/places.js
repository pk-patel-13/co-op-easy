// Places: distances, picking the right branch, links to maps and websites.

import { hoursStatus, isToday } from "./time.js";

export function milesBetween(a, b) {
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// A company's status right now. A status the company set today (Available / Busy / Closed)
// wins over opening hours. Otherwise it's open if the given branch is open.
export function companyStatus(company, branch) {
  if (isToday(company.status_at)) {
    if (company.status === "available") return { available: true, tone: "ok", text: "Available now", note: company.status_note };
    if (company.status === "busy") return { available: false, tone: "warn", text: "Busy today", note: company.status_note };
    if (company.status === "closed") return { available: false, tone: "bad", text: "Closed today", note: company.status_note };
  }
  const h = branch ? hoursStatus(branch) : { open: null, text: "Hours not published" };
  return { available: h.open === true, tone: h.open === true ? "ok" : h.open === false ? "bad" : "", text: h.text, note: "" };
}

// The branch to show for a company: the closest open one, else the closest one.
// Without a location, the first open branch (or the first branch).
export function pickBranch(company, me) {
  const branches = company.branches || [];
  if (!branches.length) return { branch: null, status: companyStatus(company, null), miles: null };
  const scored = branches.map(branch => ({
    branch,
    status: companyStatus(company, branch),
    miles: me && branch.lat != null ? milesBetween(me, branch) : null,
  }));
  const open = scored.filter(x => x.status.available);
  const pool = open.length ? open : scored;
  pool.sort((a, b) => (a.miles ?? 1e9) - (b.miles ?? 1e9));
  return pool[0];
}

export function directionsUrl(company, branch) {
  return "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(`${company.name}, ${branch.address}`);
}

export function siteLabel(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

// The phone number part of "305-555-0100 (sales)".
export function phoneNumber(text) {
  return (String(text).match(/[\d-]{7,}/) || [text])[0];
}
