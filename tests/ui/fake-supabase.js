// A stand-in for supabase-js, used only by the browser tests (tests/ui/test_ui.py).
// It keeps a small database in localStorage and follows the same rules as
// supabase/03_security.sql, so the app's account pages can be tested without a real project.
// Test helpers: window.__fake.reset(), window.__fake.makeAdmin(email)

const DB_KEY = "fake-supabase-db";
const SESSION_KEY = "fake-supabase-session";
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

const seedCompanies = await (await fetch("data/companies.json")).json();

function freshDb() {
  const companies = [], branches = [];
  for (const c of seedCompanies) {
    const { branches: bs, ...company } = c;
    companies.push({ ...company, approved: true, listed_by: null, claimed_by: null, claim_status: "none", claim_note: null,
      claimed_at: null, status: null, status_note: null, status_at: null });
    bs.forEach((b, i) => branches.push({ ...b, company_id: c.id, sort_order: i + 1 }));
  }
  return { users: [], profiles: [], companies, branches, requests: [], replies: [], reviews: [] };
}
const load = () => JSON.parse(localStorage.getItem(DB_KEY) || "null") || freshDb();
const save = db => localStorage.setItem(DB_KEY, JSON.stringify(db));
const getSession = () => JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
const setSession = s => s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY);

window.__fake = {
  reset() { localStorage.removeItem(DB_KEY); localStorage.removeItem(SESSION_KEY); },
  makeAdmin(email) { const db = load(); const p = db.profiles.find(x => x.email === email); p.is_admin = true; save(db); },
  dump() { return load(); },
};

// ---------- who can see what (mirrors 02_functions.sql + 03_security.sql) ----------

function me() { const s = getSession(); return s ? s.user.id : null; }
function profileOf(db, id) { return db.profiles.find(p => p.id === id); }
function isAdmin(db) { const p = profileOf(db, me()); return Boolean(p && p.is_admin); }
function myCompany(db) { const c = db.companies.find(c => c.claimed_by === me() && c.claim_status === "verified"); return c ? c.id : null; }
function contractorSees(db, r) {
  return db.companies.some(c => c.claimed_by === me() && c.claim_status === "verified"
    && (c.id === r.company_id || (r.company_id == null && c.kind === r.kind && c.category === r.category)));
}
function stats(db) {
  return db.companies.filter(c => c.approved).map(c => {
    const reps = db.replies.filter(p => p.company_id === c.id);
    const mins = reps.map(p => (new Date(p.created_at) - new Date(db.requests.find(r => r.id === p.request_id).created_at)) / 60000).sort((a, b) => a - b);
    const revs = db.reviews.filter(v => v.company_id === c.id);
    return {
      company_id: c.id,
      median_reply_minutes: mins.length ? mins[Math.floor((mins.length - 1) / 2)] : null,
      reply_count: reps.length,
      avg_stars: revs.length ? revs.reduce((a, v) => a + v.stars, 0) / revs.length : null,
      review_count: revs.length,
    };
  });
}
function visible(db, table) {
  const my = me();
  switch (table) {
    case "companies": return db.companies.filter(c => c.approved || c.listed_by === my || isAdmin(db));
    case "branches": return db.branches.filter(b => visible(db, "companies").some(c => c.id === b.company_id));
    case "company_stats": return stats(db);
    case "reviews": return db.reviews.map(({ client_id, ...rest }) => rest); // author hidden
    case "profiles": return my ? db.profiles.filter(p => p.id === my || isAdmin(db)
      || db.requests.some(r => r.client_id === p.id && contractorSees(db, r))) : [];
    case "requests": return my ? db.requests.filter(r => r.client_id === my || contractorSees(db, r) || isAdmin(db)) : [];
    case "replies": return my ? db.replies.filter(p => p.company_id === myCompany(db)
      || db.requests.some(r => r.id === p.request_id && r.client_id === my) || isAdmin(db)) : [];
    default: return [];
  }
}

// ---------- query builder ----------

const listeners = new Set();
const notify = () => setTimeout(() => listeners.forEach(fn => fn({})), 10);
const fail = message => ({ data: null, error: { message } });

class Query {
  constructor(table) { this.table = table; this.filters = []; this.action = "select"; }
  select(cols = "*") { this.cols = cols; return this; }
  eq(f, v) { this.filters.push(r => r[f] === v); return this; }
  neq(f, v) { this.filters.push(r => r[f] !== v); return this; }
  in(f, vs) { this.filters.push(r => vs.includes(r[f])); return this; }
  order(f, { ascending = true } = {}) { this.sort = [f, ascending]; return this; }
  limit(n) { this.max = n; return this; }
  maybeSingle() { this.single = true; return this; }
  insert(row) { this.action = "insert"; this.row = row; return this; }
  update(changes) { this.action = "update"; this.changes = changes; return this; }
  then(resolve, reject) { try { resolve(this.run()); } catch (e) { reject(e); } }

  run() {
    const db = load();
    if (this.action === "insert") return this.doInsert(db);
    if (this.action === "update") return this.doUpdate(db);
    let rows = visible(db, this.table).filter(r => this.filters.every(f => f(r)));
    if (this.sort) {
      const [f, asc] = this.sort;
      rows = [...rows].sort((a, b) => (a[f] > b[f] ? 1 : a[f] < b[f] ? -1 : 0) * (asc ? 1 : -1));
    }
    if (this.max) rows = rows.slice(0, this.max);
    rows = rows.map(r => ({ ...r }));
    if (this.cols && this.cols.includes("branches(*)")) rows.forEach(c => { c.branches = visible(db, "branches").filter(b => b.company_id === c.id); });
    if (this.cols && this.cols.includes("replies(*)")) rows.forEach(r => { r.replies = visible(db, "replies").filter(p => p.request_id === r.id); });
    if (this.table === "companies") rows.forEach(c => delete c.claim_note);
    if (this.single) return { data: rows[0] || null, error: null };
    return { data: rows, error: null };
  }

  doInsert(db) {
    const my = me();
    if (!my) return fail("new row violates row-level security policy");
    const row = { id: uid(), created_at: now(), ...this.row };
    if (this.table === "requests") {
      if (!row.need || row.need.length < 3) return fail('new row violates check constraint "requests_need_check"');
      if (row.zip && !/^\d{5}$/.test(row.zip)) return fail('new row violates check constraint "requests_zip_check"');
      Object.assign(row, { client_id: my, status: "open" });
      db.requests.push(row);
    } else if (this.table === "replies") {
      const req = db.requests.find(r => r.id === row.request_id);
      if (row.company_id !== myCompany(db) || !req || req.status !== "open" || !contractorSees(db, req)) return fail("new row violates row-level security policy for table \"replies\"");
      if (db.replies.some(p => p.request_id === row.request_id && p.company_id === row.company_id)) return fail("duplicate key value violates unique constraint");
      row.author_id = my;
      db.replies.push(row);
    } else if (this.table === "reviews") {
      const req = db.requests.find(r => r.id === row.request_id);
      const replied = db.replies.some(p => p.request_id === row.request_id && p.company_id === row.company_id);
      if (!req || req.client_id !== my || !replied) return fail("new row violates row-level security policy for table \"reviews\"");
      if (db.reviews.some(v => v.request_id === row.request_id)) return fail("duplicate key value violates unique constraint");
      row.client_id = my;
      db.reviews.push(row);
    } else return fail("permission denied for table " + this.table);
    save(db); notify();
    return { data: null, error: null };
  }

  doUpdate(db) {
    const allowed = { profiles: ["full_name", "phone", "client_type", "business_name", "zip"], requests: ["status"] }[this.table];
    if (!allowed) return fail("permission denied for table " + this.table);
    if (Object.keys(this.changes).some(k => !allowed.includes(k))) return fail("permission denied for table " + this.table);
    const mine = this.table === "profiles" ? db.profiles.filter(p => p.id === me()) : db.requests.filter(r => r.client_id === me());
    mine.filter(r => this.filters.every(f => f(r))).forEach(r => Object.assign(r, this.changes));
    save(db); notify();
    return { data: null, error: null };
  }
}

// ---------- functions (mirrors 02_functions.sql) ----------

const domain = url => String(url || "").replace(/^https?:\/\/(www\.)?/, "").replace(/[/:?#].*$/, "").toLowerCase();

const rpcs = {
  claim_company(db, { p_company, p_note }) {
    const p = profileOf(db, me());
    if (!p || p.role !== "contractor") throw new Error("Only contractor accounts can claim a company.");
    if (db.companies.some(c => c.claimed_by === me())) throw new Error("Your account already manages a company.");
    const c = db.companies.find(c => c.id === p_company && c.approved);
    if (!c) throw new Error("Company not found.");
    if (c.claimed_by) throw new Error("Someone has already claimed this company. Contact Co-op if that is wrong.");
    const user = db.users.find(u => u.id === me());
    const status = user.confirmed && domain(c.website) && user.email.split("@")[1].toLowerCase() === domain(c.website) ? "verified" : "pending";
    Object.assign(c, { claimed_by: me(), claim_status: status, claim_note: p_note, claimed_at: now() });
    p.company_id = c.id;
    return status;
  },
  submit_company(db, a) {
    const p = profileOf(db, me());
    if (!p || p.role !== "contractor") throw new Error("Only contractor accounts can add a company.");
    if (db.companies.some(c => c.claimed_by === me())) throw new Error("Your account already manages a company.");
    const id = a.p_name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Math.random().toString(16).slice(2, 7);
    db.companies.push({ id, kind: a.p_kind, name: a.p_name, category: a.p_category, website: a.p_website, description: a.p_description,
      items: [], listed_by: me(), approved: false, claimed_by: me(), claim_status: "pending", claim_note: a.p_note, claimed_at: now() });
    db.branches.push({ id: id + "-1", company_id: id, sort_order: 1, name: "Main location", address: a.p_address, phones: a.p_phone ? [a.p_phone] : [] });
    p.company_id = id;
    return id;
  },
  release_claim(db) {
    profileOf(db, me()).company_id = null;
    db.companies = db.companies.filter(c => !(c.claimed_by === me() && !c.approved));
    db.companies.filter(c => c.claimed_by === me()).forEach(c => Object.assign(c, { claimed_by: null, claim_status: "none", claim_note: null }));
  },
  set_company_status(db, { p_status, p_note }) {
    const c = db.companies.find(c => c.id === myCompany(db));
    if (!c) throw new Error("Your company is not verified yet.");
    Object.assign(c, { status: p_status, status_note: p_note, status_at: now() });
  },
  update_my_company(db, a) {
    const c = db.companies.find(c => c.id === myCompany(db));
    if (!c) throw new Error("Your company is not verified yet.");
    Object.assign(c, { description: a.p_description, email: a.p_email, contact: a.p_contact, items: a.p_items, serves: a.p_serves });
  },
  admin_pending_claims(db) {
    if (!isAdmin(db)) throw new Error("Admins only.");
    return db.companies.filter(c => c.claim_status === "pending").map(c => {
      const p = profileOf(db, c.claimed_by);
      return { company_id: c.id, company_name: c.name, website: c.website, is_new_listing: !c.approved, claim_note: c.claim_note,
        claimed_at: c.claimed_at, full_name: p.full_name, email: p.email, phone: p.phone };
    });
  },
  admin_decide_claim(db, { p_company, p_approve }) {
    if (!isAdmin(db)) throw new Error("Admins only.");
    const c = db.companies.find(c => c.id === p_company);
    if (p_approve) Object.assign(c, { claim_status: "verified", approved: true });
    else {
      const owner = profileOf(db, c.claimed_by);
      if (owner) owner.company_id = null;
      if (!c.approved) db.companies = db.companies.filter(x => x !== c);
      else Object.assign(c, { claimed_by: null, claim_status: "none", claim_note: null });
    }
  },
};

// ---------- auth ----------

const authListeners = new Set();
const emit = (event, session) => authListeners.forEach(fn => fn(event, session));

function newProfile(user, meta) {
  const role = meta.role === "contractor" ? "contractor" : "client";
  return {
    id: user.id, email: user.email, role, full_name: meta.full_name || user.email.split("@")[0], phone: meta.phone || null,
    client_type: role === "contractor" ? null : meta.client_type === "business" ? "business" : "homeowner",
    business_name: meta.business_name || null, zip: /^\d{5}$/.test(meta.zip || "") ? meta.zip : null,
    company_id: null, is_admin: false, created_at: now(),
  };
}

const auth = {
  async getSession() { return { data: { session: getSession() }, error: null }; },
  onAuthStateChange(fn) { authListeners.add(fn); return { data: { subscription: { unsubscribe: () => authListeners.delete(fn) } } }; },
  async signUp({ email, password, options }) {
    const db = load();
    if (db.users.some(u => u.email === email)) return fail("User already registered");
    if (password.length < 6) return fail("Password should be at least 6 characters.");
    const confirmNeeded = localStorage.getItem("fake-confirm-email") === "on";
    const user = { id: uid(), email, password, confirmed: !confirmNeeded };
    db.users.push(user);
    db.profiles.push(newProfile(user, options.data || {}));
    save(db);
    if (confirmNeeded) return { data: { user: { id: user.id, email }, session: null }, error: null };
    const session = { user: { id: user.id, email } };
    setSession(session); emit("SIGNED_IN", session);
    return { data: { user: session.user, session }, error: null };
  },
  async signInWithPassword({ email, password }) {
    const user = load().users.find(u => u.email === email && u.password === password);
    if (!user) return fail("Invalid login credentials");
    if (!user.confirmed) return fail("Email not confirmed");
    const session = { user: { id: user.id, email } };
    setSession(session); emit("SIGNED_IN", session);
    return { data: { session }, error: null };
  },
  async signOut() { setSession(null); emit("SIGNED_OUT", null); return { error: null }; },
  async resetPasswordForEmail() { return { data: {}, error: null }; },
  async updateUser({ password }) {
    const db = load(); db.users.find(u => u.id === me()).password = password; save(db);
    return { data: {}, error: null };
  },
};

// ---------- the client ----------

export function createClient() {
  return {
    auth,
    from: table => new Query(table),
    async rpc(name, args = {}) {
      const db = load();
      try {
        const data = rpcs[name](db, args);
        save(db); notify();
        return { data: data ?? null, error: null };
      } catch (e) { return fail(e.message); }
    },
    channel() {
      const ch = { on(_type, _filter, fn) { listeners.add(fn); ch.fns = [...(ch.fns || []), fn]; return ch; }, subscribe() { return ch; } };
      return ch;
    },
    removeChannel(ch) { (ch.fns || []).forEach(fn => listeners.delete(fn)); },
  };
}
