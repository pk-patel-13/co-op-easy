// Co-op starts here: load data, then show the page that matches the address.
//
// Addresses look like #/find/services or #/company/del-sol-roofing, so GitHub Pages
// can serve every page from index.html with no server setup.
//
// Where things live:
//   js/lib/         small helpers (DOM, time, places)
//   js/data/        every database call, grouped by feature
//   js/components/  pieces used by several pages (map, company card, dialogs)
//   js/pages/       one file (or folder) per page

import { $, esc, toast } from "./lib/dom.js";
import { live, state } from "./data/client.js";
import { loadZips, loadCompanies, categoriesOf } from "./data/directory.js";
import { startAuth, setNewPassword } from "./data/account.js";
import { setCategories } from "./components/look.js";
import { renderNav } from "./components/nav.js";
import { openDialog, closeDialog } from "./components/dialog.js";
import { renderHome } from "./pages/home.js";
import { renderFind } from "./pages/find.js";
import { renderCompany } from "./pages/company.js";
import { renderSignup } from "./pages/signup.js";
import { renderLogin } from "./pages/login.js";
import { renderAccount } from "./pages/account/index.js";
import { renderAdmin } from "./pages/admin.js";

// address -> page. A page may return a clean-up function (e.g. to remove its map).
const routes = [
  [/^\/?$/, view => renderHome(view)],
  [/^\/find\/(services|materials)$/, (view, m) => renderFind(view, m[1])],
  [/^\/company\/([\w-]+)$/, (view, m) => renderCompany(view, m[1])],
  [/^\/signup$/, (view, _m, query) => renderSignup(view, query)],
  [/^\/login$/, view => renderLogin(view)],
  [/^\/account$/, view => renderAccount(view)],
  [/^\/admin$/, view => renderAdmin(view)],
];

let cleanup = null;

// "#/find/services?x=1#how" -> path "/find/services", query "x=1", anchor "how"
function parseHash(hash) {
  const raw = hash.replace(/^#/, "") || "/";
  const [pathAndQuery, anchor = ""] = raw.split("#");
  const [path, queryString = ""] = pathAndQuery.split("?");
  return { path: path || "/", query: new URLSearchParams(queryString), anchor };
}

async function route() {
  if (cleanup) { cleanup(); cleanup = null; }
  const { path, query, anchor } = parseHash(location.hash);
  const view = $("#view");

  const found = routes.find(([pattern]) => pattern.test(path));
  if (!found) {
    view.innerHTML = `<div class="card"><h1 class="title">Page not found</h1><p><a href="#/">Go to the home page</a></p></div>`;
    return;
  }
  const [pattern, render] = found;
  const result = await render(view, path.match(pattern), query);
  if (typeof result === "function") cleanup = result;

  if (anchor) document.getElementById(anchor)?.scrollIntoView();
  else window.scrollTo(0, 0);
}

// After an email link (?welcome=1 or ?reset=1), tidy the address bar.
function handleEmailLinks() {
  const params = new URLSearchParams(location.search);
  if (!params.has("welcome") && !params.has("reset")) return;
  history.replaceState(null, "", location.pathname + "#/account");
  if (!state.session) return;
  if (params.has("welcome")) toast("Email confirmed. Welcome to Co-op!");
  if (params.has("reset")) askForNewPassword();
}

function askForNewPassword() {
  const dialog = openDialog(`
    <form id="np-form">
      <h2>Choose a new password</h2>
      <div class="field"><label for="np-pass">New password</label><input id="np-pass" class="input" type="password" minlength="8" autocomplete="new-password"></div>
      <button class="btn brand" type="submit">Save password</button>
    </form>`);
  $("#np-form", dialog).addEventListener("submit", async e => {
    e.preventDefault();
    if ($("#np-pass").value.length < 8) { toast("Use at least 8 characters."); return; }
    try { await setNewPassword($("#np-pass").value); closeDialog(); toast("Password updated"); }
    catch (err) { toast(err.message); }
  });
}

async function start() {
  $("#demo-banner").hidden = live;
  try {
    await Promise.all([loadZips(), loadCompanies()]);
  } catch (err) {
    $("#view").innerHTML = `<div class="card"><p class="error">Couldn't load the directory: ${esc(err.message)}</p></div>`;
    return;
  }
  setCategories(categoriesOf());

  await startAuth(() => { renderNav(); route(); });
  handleEmailLinks();
  renderNav();
  window.addEventListener("hashchange", route);
  route();
}

start();
