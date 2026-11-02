import { useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { formatDateTime } from "../lib/format";
import {
  arc,
  bearing,
  splitLine,
  unwrapLine,
  type RoutePath,
  type RouteStop,
  type TrackRoute,
} from "../lib/trackRoute";

interface Props {
  route: TrackRoute;
  /** Shipment mode, picks the plane / ship / truck marker. */
  mode?: string | null;
  /** CSS height, default 320px. */
  height?: number;
  /** ShipsGo's real route (job_tracking.route_path, 0202), drawn instead of
   *  straight legs. Without it a sea shipment gets a worked-out sea lane. */
  path?: RoutePath | null;
}

type LL = [number, number];

/** Sea lanes between two ports (src/lib/seaLanes.ts), loaded on demand:
 *  only maps with no ShipsGo route need the lane network. */
let seaRouter: Promise<(a: LL, b: LL) => LL[] | null> | null = null;
function loadSeaRouter() {
  seaRouter ??= import("../lib/seaLanes").then((m) => (a: LL, b: LL) => {
    try {
      return m.seaRoute(a, b);
    } catch {
      return null;
    }
  });
  return seaRouter;
}

type Pos = RouteStop & { lat: number; lon: number };
const hasPos = (s: RouteStop): s is Pos => typeof s.lat === "number" && typeof s.lon === "number";

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

// Plane pointing north, rotated to the leg's bearing.
const PLANE_WHITE =
  '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="#fff" d="M12 1.5c.9 0 1.5 1.1 1.5 2.4v5.4l8 4.7v2.2l-8-2.4v5l2.3 1.7V22L12 21l-3.8 1v-1.5l2.3-1.7v-5l-8 2.4V15l8-4.7V3.9c0-1.3.6-2.4 1.5-2.4z"/></svg>';
// Cargo ship and truck glyphs for the vehicle badge (white on the badge colour).
const SHIP =
  '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="#fff" d="M9 3h4v3h4l1 5H5.5L7 6h2V3zm-6 9h18l-2.6 6.2c-.3.5-.8.8-1.4.8H6.9c-.6 0-1.1-.3-1.4-.8L3 12zm1 9c1.3 0 2-.6 2.7-1 .6.4 1.4 1 2.6 1s2-.6 2.7-1c.6.4 1.4 1 2.7 1s2-.6 2.6-1c.7.4 1.4 1 2.7 1v1.5c-1.3 0-2-.5-2.7-.9-.6.4-1.3.9-2.6.9s-2.1-.5-2.7-.9c-.7.4-1.4.9-2.7.9s-2-.5-2.6-.9c-.7.4-1.4.9-2.7.9V21z"/></svg>';
const TRUCK =
  '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="#fff" d="M2 5h12v10H2V5zm13 3h4l3 3.5V15h-7V8zM6 19a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm12 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/></svg>';

/**
 * Leaflet map of a shipment's route, like the ShipsGo view: numbered stops,
 * flown / sailed legs solid green, legs still to go dashed blue, and a plane
 * (or ship / truck) where the cargo is now, an estimate along the leg while
 * it is in the air or at sea. Leaflet loads on demand, out of the main
 * bundle. Falls back to a note when no stop has coordinates yet.
 */
export default function TrackingMap({ route, mode, height = 320, path }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  const stops = useMemo(() => route.stops.filter(hasPos), [route.stops]);
  const hasData = stops.length > 0;
  const kind = /^(air|courier)/i.test(mode ?? "") ? "air" : /^road/i.test(mode ?? "") ? "road" : "sea";
  // Redraw only when what's on the map changes.
  const key = JSON.stringify([
    stops.map((s) => [s.lat, s.lon, s.reached]),
    route.doneLegs,
    route.moving,
    route.position && [route.position.lat.toFixed(3), route.position.lon.toFixed(3)],
    kind,
    path?.map((p) => [p.s, p.c.length, p.at]),
  ]);

  useEffect(() => {
    if (!hasData || !boxRef.current) return;
    let map: import("leaflet").Map | null = null;
    let cancelled = false;
    let observer: ResizeObserver | null = null;

    (async () => {
      try {
        const L = (await import("leaflet")).default;
        if (cancelled || !boxRef.current) return;

        // Dragging stops at the world's top and bottom edges (no grey band
        // past the poles); left / right wraps round as before.
        map = L.map(boxRef.current, {
          scrollWheelZoom: false,
          attributionControl: true,
          worldCopyJump: true,
          maxBounds: [
            [-85, -100000],
            [85, 100000],
          ],
          maxBoundsViscosity: 1,
        });
        // Esri World Street Map: English labels everywhere (the standard OSM
        // tiles name each country in its own script). Note the {y}/{x} order.
        L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", {
          maxZoom: 18,
          attribution: "Tiles &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors",
        }).addTo(map);

        const bounds: [number, number][] = [];
        const done = { color: "#8cbc43", weight: 3, opacity: 0.95 };
        const todo = { color: "#3b82c4", weight: 3, opacity: 0.9, dashArray: "8 8" };

        let pos = route.position;
        const line = (pts: LL[], style: object) => {
          if (pts.length < 2) return;
          L.polyline(pts, style).addTo(map!);
          bounds.push(...pts);
        };
        const real = (path ?? []).filter((p) => p.c.length >= 2);

        if (real.length) {
          // ShipsGo's route: sailed solid, still to go dashed, split where the
          // vessel / flight is now, and that live position for the marker.
          let lastLon: number | null = null;
          for (const seg of real) {
            const pts = unwrapLine(seg.c, lastLon);
            lastLon = pts[pts.length - 1][1];
            if (seg.s === "PAST") line(pts, done);
            else if (seg.s === "FUTURE") line(pts, todo);
            else {
              const k = Math.min(pts.length - 1, Math.max(0, seg.i ?? 0));
              const at: LL | null = seg.at ? unwrapLine([seg.at], pts[k][1])[0] : null;
              line(at ? [...pts.slice(0, k + 1), at] : pts.slice(0, k + 1), done);
              line(at ? [at, ...pts.slice(k + 1)] : pts.slice(k), todo);
              if (at && !route.position?.live) {
                const ahead = pts[Math.min(pts.length - 1, k + 1)];
                pos = {
                  lat: at[0],
                  lon: at[1],
                  label: kind === "air" ? "Flight position" : "Vessel position",
                  estimated: false,
                  bearing: bearing({ lat: at[0], lon: at[1] }, { lat: ahead[0], lon: ahead[1] }),
                };
              }
            }
          }
        } else {
          // Legs between consecutive stops that have coordinates. A leg's
          // index is the index of its start stop in route.stops. At sea the
          // leg follows the shipping lanes, not a straight line over land.
          const lane = kind === "sea" && stops.length > 1 ? await loadSeaRouter().catch(() => null) : null;
          if (cancelled) return;
          for (let i = 0; i < stops.length - 1; i++) {
            const a = stops[i];
            const b = stops[i + 1];
            const leg = route.stops.indexOf(a);
            const sea = lane?.([a.lat, a.lon], [b.lat, b.lon]);
            const pts = sea ? unwrapLine(sea) : arc(a, b);
            if (route.moving && route.moving.leg === leg) {
              const cut = splitLine(pts, route.moving.fraction);
              line(cut.done, done);
              line(cut.todo, todo);
              // The estimate sits on the lane (on water), not on the straight line.
              if (sea && pos?.estimated) pos = { ...pos, lat: cut.at.lat, lon: cut.at.lon, bearing: cut.bearing };
            } else {
              line(pts, leg < route.doneLegs ? done : todo);
            }
          }
        }

        stops.forEach((s, i) => {
          const icon = L.divIcon({
            className: `trk-stop${s.reached ? " reached" : ""}`,
            html: `<span>${i + 1}</span>`,
            iconSize: [24, 24],
            iconAnchor: [12, 12],
          });
          const rows = s.events
            .map(
              (e) =>
                `<tr><td><b>${esc(e.code ?? "")}</b></td><td>${e.at ? esc(formatDateTime(e.at)) : ""}</td><td>${esc(
                  e.via ?? "",
                )}</td><td>${e.actual ? "✓" : ""}</td></tr>`,
            )
            .join("");
          L.marker([s.lat, s.lon], { icon, zIndexOffset: 100 })
            .addTo(map!)
            .bindPopup(
              `<b>${esc(s.name || s.code || "Stop")}</b>${rows ? `<table class="trk-pop">${rows}</table>` : ""}`,
            );
          bounds.push([s.lat, s.lon]);
        });

        if (pos) {
          // A badge that stands out from the stops: pulsing when it's a real
          // position (AIS / carrier), dashed when it's only an estimate.
          const state = pos.estimated ? "est" : "live";
          const glyph =
            kind === "air"
              ? `<span style="display:block;transform:rotate(${pos.bearing}deg)">${PLANE_WHITE}</span>`
              : kind === "road"
                ? TRUCK
                : SHIP;
          const icon = L.divIcon({
            className: `trk-vehicle ${state}`,
            html: `<span class="trk-vehicle-ring"></span><span class="trk-vehicle-badge">${glyph}</span>`,
            iconSize: [40, 40],
            iconAnchor: [20, 20],
            popupAnchor: [0, -18],
          });
          const what = kind === "air" ? "flight" : kind === "road" ? "truck" : "vessel";
          const title = `${pos.estimated ? "Estimated" : "Live"} ${what} position`;
          // The vessel / flight and voyage: the latest route event that names one.
          const named = route.stops.flatMap((s) => s.events).filter((e) => (e.via ?? "").trim());
          const via = named[named.length - 1];
          const name = via?.via?.trim() || "";
          // No tracking source named (ShipsGo, AIS): customers see these maps.
          const rows = [
            ["Status", `<span class="trk-pop-state ${state}">${esc(pos.estimated ? "Estimated" : "Live")}</span>`],
            pos.seenAt ? ["Last update", esc(formatDateTime(pos.seenAt))] : null,
            typeof pos.speedKn === "number" ? ["Speed", `${pos.speedKn.toFixed(1)} kn`] : null,
          ].filter((r): r is string[] => !!r);
          const popup =
            `<div class="trk-pop-vessel"><b>${esc(name || title)}</b>` +
            (via?.voyage ? ` <span class="trk-pop-voy">${esc(via.voyage)}</span>` : "") +
            `</div><table class="trk-pop">${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}</table>`;
          const marker = L.marker([pos.lat, pos.lon], { icon, zIndexOffset: 200, title })
            .addTo(map)
            .bindPopup(popup, { minWidth: 200 })
            // Always-on name tag next to the ship, so it reads without a click.
            .bindTooltip(`${esc(name || title)} · ${pos.estimated ? "Estimated" : "Live"}`, {
              permanent: true,
              direction: "right",
              offset: [20, 0],
              className: `trk-vehicle-tip ${state}`,
            });
          // Details on hover as well as on click.
          marker.on("mouseover", () => marker.openPopup());
          bounds.push([pos.lat, pos.lon]);

          // On-map call to action: jump to the vessel and open its details.
          const Locate = L.Control.extend({
            onAdd() {
              const btn = L.DomUtil.create("button", `trk-locate ${state}`);
              btn.type = "button";
              btn.innerHTML = `<span class="dot"></span>${esc(title)}`;
              L.DomEvent.disableClickPropagation(btn);
              const at = marker.getLatLng();
              L.DomEvent.on(btn, "click", () => {
                map?.flyTo(at, Math.max(map.getZoom(), 5), { duration: 0.8 });
                marker.openPopup();
              });
              return btn;
            },
          });
          new Locate({ position: "topright" }).addTo(map);
        }

        // Frame the route; again whenever the box changes size (a modal
        // opening, a hidden tab shown), else a map laid out at 0 x 0 keeps a
        // wild zoom.
        const frame = () => {
          if (!map || !boxRef.current) return;
          map.invalidateSize();
          // Never zoom out past the point where the world (256px tall at
          // zoom 0, doubling each level) fills the box: on a narrow phone
          // fitBounds would otherwise go so far out that grey shows above
          // and below the map.
          map.setMinZoom(Math.max(1, Math.ceil(Math.log2(boxRef.current.clientHeight / 256))));
          if (bounds.length === 1) map.setView(bounds[0], 5);
          else map.fitBounds(bounds, { padding: [36, 36], maxZoom: 6 });
        };
        frame();
        let lastW = boxRef.current.clientWidth;
        let lastH = boxRef.current.clientHeight;
        observer = new ResizeObserver(([entry]) => {
          const { width, height } = entry.contentRect;
          if (width > 0 && height > 0 && (Math.abs(width - lastW) > 2 || Math.abs(height - lastH) > 2)) {
            lastW = width;
            lastH = height;
            frame();
          }
        });
        observer.observe(boxRef.current);
        setReady(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
      map?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasData, key]);

  if (!hasData || failed) {
    return (
      <div className="trk-map-empty" style={{ height }}>
        {failed
          ? "Map could not load."
          : "No route on the map yet, it appears once the carrier reports the routing."}
      </div>
    );
  }

  return (
    <div
      ref={boxRef}
      className="trk-map"
      style={{ height, opacity: ready ? 1 : 0.4, transition: "opacity .2s" }}
    />
  );
}
