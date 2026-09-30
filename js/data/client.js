// The connection to Supabase, and the shared app state.
// With no keys in config.js the site runs in preview mode (browse only).

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config.js";

export const live = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

// PKCE sends email links back as ?code=..., which doesn't clash with #/page addresses.
export const sb = live
  ? (await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm"))
      .createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { flowType: "pkce" } })
  : null;

// Everything pages read from. Filled by the functions in this folder.
export const state = {
  companies: [],   // each with .branches
  stats: {},       // company id -> { median_reply_minutes, reply_count, avg_stars, review_count }
  zips: {},        // "33130" -> [lat, lng]
  session: null,
  profile: null,
};

// Turn a Supabase error into a normal Error with a readable message.
export function check(error) {
  if (error) throw new Error(error.message || "Something went wrong. Please try again.");
}

export function myId() {
  return state.session ? state.session.user.id : null;
}
