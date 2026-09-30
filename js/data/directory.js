// The public directory: companies, their branches, ratings, reviews, ZIP codes.

import { live, sb, state, check } from "./client.js";

// Columns anyone may read (claim notes stay private, see supabase/03_security.sql).
const COMPANY_COLUMNS = [
  "id", "kind", "name", "category", "description", "email", "website", "contact", "items", "extra", "serves",
  "license", "founded", "image_url", "image_is_photo", "image_source", "checked_on", "approved",
  "claimed_by", "claim_status", "status", "status_note", "status_at",
].join(",");

export async function loadZips() {
  const res = await fetch("data/zips.json");
  state.zips = await res.json();
}

export async function loadCompanies() {
  if (live) {
    const { data, error } = await sb.from("companies")
      .select(`${COMPANY_COLUMNS}, branches(*)`)
      .order("name");
    if (!error && data && data.length) {
      data.forEach(c => c.branches.sort((a, b) => a.sort_order - b.sort_order));
      state.companies = data;
      return;
    }
    console.warn("Using the bundled company list:", error && error.message);
  }
  const res = await fetch("data/companies.json");
  state.companies = await res.json();
}

export async function loadStats() {
  if (!live) return;
  const { data, error } = await sb.from("company_stats").select("*");
  if (error) { console.warn(error.message); return; }
  state.stats = Object.fromEntries(data.map(row => [row.company_id, row]));
}

export async function loadReviews(companyId) {
  if (!live) return [];
  const { data, error } = await sb.from("reviews").select("stars, body, created_at")
    .eq("company_id", companyId).order("created_at", { ascending: false }).limit(50);
  check(error);
  return data;
}

export function companyById(id) {
  return state.companies.find(c => c.id === id);
}

export function categoriesOf(kind) {
  return [...new Set(state.companies.filter(c => !kind || c.kind === kind).map(c => c.category))];
}
