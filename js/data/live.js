// Live updates: call onChange when requests, replies or company statuses change.

import { live, sb } from "./client.js";

export function watchChanges(onChange) {
  if (!live) return () => {};
  const channel = sb.channel("coop-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "requests" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "replies" }, onChange)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "companies" }, onChange)
    .subscribe();
  return () => sb.removeChannel(channel);
}
