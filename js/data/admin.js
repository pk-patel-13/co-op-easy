// Admin tools: review company claims. The database refuses these for non-admins.

import { sb, check } from "./client.js";

export async function pendingClaims() {
  const { data, error } = await sb.rpc("admin_pending_claims");
  check(error);
  return data;
}

export async function decideClaim(companyId, approve) {
  const { error } = await sb.rpc("admin_decide_claim", { p_company: companyId, p_approve: approve });
  check(error);
}
