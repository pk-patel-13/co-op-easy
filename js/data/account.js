// Accounts: sign up, sign in, profile.

import { live, sb, state, check, myId } from "./client.js";

const here = () => location.origin + location.pathname;

export async function startAuth(onUserChange) {
  if (!live) return;
  const { data } = await sb.auth.getSession();
  state.session = data.session;
  await loadProfile();
  sb.auth.onAuthStateChange((_event, session) => {
    const changed = (session && session.user.id) !== myId();
    state.session = session;
    // Supabase advises not to call it from inside this listener, so wait a tick.
    if (changed) setTimeout(async () => { await loadProfile(); onUserChange(); }, 0);
  });
}

async function loadProfile() {
  state.profile = null;
  if (!live || !state.session) return;
  const { data } = await sb.from("profiles").select("*").eq("id", myId()).maybeSingle();
  state.profile = data;
}

// details: role, full_name, phone, zip, client_type, business_name (saved by a database trigger)
export async function signUp({ email, password, ...details }) {
  const { data, error } = await sb.auth.signUp({ email, password, options: { data: details, emailRedirectTo: here() + "?welcome=1" } });
  check(error);
  return { needsEmailConfirm: !data.session };
}

export async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  check(error);
}

export async function sendPasswordReset(email) {
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: here() + "?reset=1" });
  check(error);
}

export async function setNewPassword(password) {
  const { error } = await sb.auth.updateUser({ password });
  check(error);
}

export async function signOut() {
  await sb.auth.signOut();
  state.session = null;
  state.profile = null;
}

export async function updateProfile(changes) {
  const { error } = await sb.from("profiles").update(changes).eq("id", myId());
  check(error);
  await loadProfile();
}
