// A client's requests, the replies to them, and reviews.

import { sb, check, myId } from "./client.js";

export async function sendRequest(request) {
  const { error } = await sb.from("requests").insert(request);
  check(error);
}

// My requests with their replies and my review (if any).
export async function myRequests() {
  const { data, error } = await sb.from("requests").select("*, replies(*)")
    .eq("client_id", myId()).order("created_at", { ascending: false });
  check(error);
  let reviews = [];
  if (data.length) {
    const res = await sb.from("reviews").select("request_id, company_id, stars, body").in("request_id", data.map(r => r.id));
    check(res.error);
    reviews = res.data;
  }
  const byRequest = Object.fromEntries(reviews.map(r => [r.request_id, r]));
  return data.map(r => ({ ...r, review: byRequest[r.id] || null }));
}

export async function setRequestStatus(id, status) {
  const { error } = await sb.from("requests").update({ status }).eq("id", id);
  check(error);
}

export async function postReview(review) {
  const { error } = await sb.from("reviews").insert(review);
  check(error);
}
