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
const PLANE =
  '<svg viewBox="0 0 24 24" width="26" height="26"><path fill="#1d5ba8" stroke="#fff" stroke-width="1" d="M12 1.5c.9 0 1.5 1.1 1.5 2.4v5.4l8 4.7v2.2l-8-2.4v5l2.3 1.7V22L12 21l-3.8 1v-1.5l2.3-1.7v-5l-8 2.4V15l8-4.7V3.9c0-1.3.6-2.4 1.5-2.4z"/></svg>';

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

        map = L.map(boxRef.current, { scrollWheelZoom: false, attributionControl: true, worldCopyJump: true });
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 18,
          attribution: "&copy; OpenStreetMap contributors",
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
              if (at) {
                const ahead = pts[Math.min(pts.length - 1, k + 1)];
                pos = {
                  lat: at[0],
                  lon: at[1],
                  label: kind === "air" ? "Flight position (ShipsGo)" : "Vessel position (ShipsGo)",
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
          const html =
            kind === "air"
              ? `<span style="display:block;transform:rotate(${pos.bearing}deg)">${PLANE}</span>`
              : kind === "road"
                ? "🚚"
                : "🚢";
          const icon = L.divIcon({ className: "trk-vehicle", html, iconSize: [26, 26], iconAnchor: [13, 13] });
          L.marker([pos.lat, pos.lon], { icon, zIndexOffset: 200 })
            .addTo(map)
            .bindPopup(esc(pos.label));
        }

        // Frame the route; again whenever the box changes size (a modal
        // opening, a hidden tab shown), else a map laid out at 0 x 0 keeps a
        // wild zoom.
        const frame = () => {
          if (!map) return;
          map.invalidateSize();
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
