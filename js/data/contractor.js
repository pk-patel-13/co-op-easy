// Contractor tools: claim a company, set availability, reply to requests, edit details.

import { sb, check, myId } from "./client.js";

// Returns "verified" or "pending".
export async function claimCompany(companyId, note) {
  const { data, error } = await sb.rpc("claim_company", { p_company: companyId, p_note: note });
  check(error);
  return data;
}

export async function submitCompany(fields) {
  const { data, error } = await sb.rpc("submit_company", fields);
  check(error);
  return data;
}

export async function releaseClaim() {
  const { error } = await sb.rpc("release_claim");
  check(error);
}

export async function setCompanyStatus(status, note) {
  const { error } = await sb.rpc("set_company_status", { p_status: status, p_note: note });
  check(error);
}

export async function updateMyCompany(fields) {
  const { error } = await sb.rpc("update_my_company", fields);
  check(error);
}

// Requests the database lets this contractor see, with the client's contact details.
export async function incomingRequests() {
  const { data, error } = await sb.from("requests").select("*, replies(*)")
    .neq("client_id", myId()).order("created_at", { ascending: false }).limit(100);
  check(error);
  const clientIds = [...new Set(data.map(r => r.client_id))];
  let clients = {};
  if (clientIds.length) {
    const res = await sb.from("profiles").select("id, full_name, phone, email, client_type, business_name").in("id", clientIds);
    check(res.error);
    clients = Object.fromEntries(res.data.map(p => [p.id, p]));
  }
  return data.map(r => ({ ...r, client: clients[r.client_id] || null }));
}

export async function sendReply(reply) {
  const { error } = await sb.from("replies").insert(reply);
  check(error);
}
