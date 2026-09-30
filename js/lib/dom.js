// DOM helpers: finding elements, safe text, toast messages, remembered settings.

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// Escape text before putting it inside HTML.
export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

export function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 3000);
}

// Small per-browser preferences (location, sort). The site works without them.
export const saved = {
  get(key) { try { return JSON.parse(localStorage.getItem("coop." + key)); } catch { return null; } },
  set(key, value) { try { localStorage.setItem("coop." + key, JSON.stringify(value)); } catch { /* private mode */ } },
};

// Any <button class="copy" data-copy="..."> copies its text.
document.addEventListener("click", async event => {
  const button = event.target.closest(".copy");
  if (!button) return;
  try {
    await navigator.clipboard.writeText(button.dataset.copy);
    button.textContent = "copied";
  } catch {
    button.textContent = "select it";
  }
  setTimeout(() => { button.textContent = "copy"; }, 1500);
});
