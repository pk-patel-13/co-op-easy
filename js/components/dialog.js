// The pop-up window used by forms (request, reply, review, new password).

import { $ } from "../lib/dom.js";

export function openDialog(html) {
  const dialog = $("#dialog");
  dialog.innerHTML = html;
  dialog.showModal();
  dialog.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => dialog.close()));
  return dialog;
}

export function closeDialog() {
  $("#dialog").close();
}
