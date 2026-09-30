// The visitor's location: { lat, lng, label, zip }. Kept in this browser only.

import { saved } from "../lib/dom.js";

export function myLocation() {
  return saved.get("location");
}

export function setMyLocation(location) {
  saved.set("location", location);
}
