// The colorful directory map: MapLibre + free OpenFreeMap styles (no key, no usage limits).
// maplibregl is the global from the script tag in index.html.

import { esc } from "../lib/dom.js";
import { categoryColor } from "./look.js";

const STYLE_LIGHT = "https://tiles.openfreemap.org/styles/liberty";
const STYLE_DARK = "https://tiles.openfreemap.org/styles/fiord";
const MIAMI = [-80.25, 25.79]; // [lng, lat]
const RADIUS_MILES = 5;

function webglWorks() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(window.maplibregl && (canvas.getContext("webgl2") || canvas.getContext("webgl")));
  } catch { return false; }
}

// A circle polygon around a point, for the "within 5 miles" ring.
function circle(lat, lng, miles, steps = 64) {
  const dLat = miles / 69;
  const dLng = miles / (69 * Math.cos(lat * Math.PI / 180));
  const ring = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [ring] } };
}

export function createMap(element, { onPickLocation, onPickCompany }) {
  if (!webglWorks()) {
    element.innerHTML = `<p class="map-note">The map needs a newer browser. The list still works.</p>`;
    return { show() {}, focus() {}, resize() {}, destroy() {} };
  }

  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  const map = new maplibregl.Map({
    container: element,
    style: dark ? STYLE_DARK : STYLE_LIGHT,
    center: MIAMI,
    zoom: 10,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.on("click", e => onPickLocation(e.lngLat.lat, e.lngLat.lng));

  const loaded = new Promise(resolve => map.on("load", resolve));
  let markers = [];          // { companyId, marker }
  let meMarker = null;
  let lastMeKey = "";
  let fittedOnce = false;

  async function drawRadius(me) {
    await loaded;
    const data = me ? circle(me.lat, me.lng, RADIUS_MILES) : { type: "FeatureCollection", features: [] };
    if (map.getSource("radius")) { map.getSource("radius").setData(data); return; }
    map.addSource("radius", { type: "geojson", data });
    map.addLayer({ id: "radius-fill", type: "fill", source: "radius", paint: { "fill-color": "#2563ff", "fill-opacity": 0.08 } });
    map.addLayer({ id: "radius-line", type: "line", source: "radius", paint: { "line-color": "#2563ff", "line-width": 2, "line-dasharray": [2, 2] } });
  }

  function fit(points) {
    if (!points.length) return;
    const bounds = new maplibregl.LngLatBounds(points[0], points[0]);
    points.forEach(p => bounds.extend(p));
    map.fitBounds(bounds, { padding: 50, maxZoom: 13, duration: fittedOnce ? 600 : 0 });
    fittedOnce = true;
  }

  return {
    // rows: [{ company, number, status }] in list order. me: { lat, lng } or null.
    show(rows, me) {
      markers.forEach(m => m.marker.remove());
      markers = [];
      const points = [];
      for (const { company, number, status } of rows) {
        const color = categoryColor(company.category);
        for (const branch of company.branches || []) {
          if (branch.lat == null) continue;
          const root = document.createElement("div");
          root.innerHTML = `<div class="pin ${status.available ? "open" : "closed"}" style="background:${color};color:${color}" title="${esc(company.name)}"><span>${number}</span></div>`;
          root.addEventListener("click", () => onPickCompany(company.id));
          const popup = new maplibregl.Popup({ offset: 28, maxWidth: "260px" }).setHTML(`
            <div class="popup">
              <b>${esc(company.name)}</b>
              ${company.branches.length > 1 ? `<span class="branch">${esc(branch.name)}</span>` : ""}
              <span class="pill ${status.tone}">${esc(status.text)}</span>
              <span class="small">${esc(branch.address)}</span>
              <a href="#/company/${esc(company.id)}">View company →</a>
            </div>`);
          const marker = new maplibregl.Marker({ element: root, anchor: "bottom" })
            .setLngLat([branch.lng, branch.lat]).setPopup(popup).addTo(map);
          markers.push({ companyId: company.id, marker });
          points.push([branch.lng, branch.lat]);
        }
      }

      // you are here + 5-mile ring
      const meKey = me ? `${me.lat},${me.lng}` : "";
      if (meKey !== lastMeKey) {
        if (meMarker) meMarker.remove();
        meMarker = null;
        if (me) {
          const dot = document.createElement("div");
          dot.className = "me-dot";
          dot.title = "You";
          meMarker = new maplibregl.Marker({ element: dot }).setLngLat([me.lng, me.lat]).addTo(map);
        }
        drawRadius(me);
      }

      // Fit the view the first time, and when the location changes (to you + the closest pins).
      if (!fittedOnce) fit(me ? [[me.lng, me.lat], ...points] : points);
      else if (meKey !== lastMeKey && me) {
        const near = points.map(p => ({ p, d: (p[0] - me.lng) ** 2 + (p[1] - me.lat) ** 2 }))
          .sort((a, b) => a.d - b.d).slice(0, 5).map(x => x.p);
        fit([[me.lng, me.lat], ...near]);
      }
      lastMeKey = meKey;
    },

    // Fly to a company and open its popup.
    focus(companyId) {
      const hit = markers.find(m => m.companyId === companyId);
      if (!hit) return;
      map.flyTo({ center: hit.marker.getLngLat(), zoom: Math.max(map.getZoom(), 13) });
      if (!hit.marker.getPopup().isOpen()) hit.marker.togglePopup();
    },

    // Call after the map's box changes size (e.g. switching List / Map on phones).
    resize() { map.resize(); },

    destroy() {
      if (map.isStyleLoaded()) map.remove();
      else { map.once("load", () => map.remove()); map.once("error", () => map.remove()); }
    },
  };
}
