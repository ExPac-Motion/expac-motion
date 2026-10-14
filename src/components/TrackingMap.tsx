import { useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { formatDateTime } from "../lib/format";
import { arc, type RouteStop, type TrackRoute } from "../lib/trackRoute";

interface Props {
  route: TrackRoute;
  /** Shipment mode, picks the plane / ship / truck marker. */
  mode?: string | null;
  /** CSS height, default 320px. */
  height?: number;
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
export default function TrackingMap({ route, mode, height = 320 }: Props) {
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
  ]);

  useEffect(() => {
    if (!hasData || !boxRef.current) return;
    let map: import("leaflet").Map | null = null;
    let cancelled = false;

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

        // Legs between consecutive stops that have coordinates. A leg's index
        // is the index of its start stop in route.stops.
        for (let i = 0; i < stops.length - 1; i++) {
          const a = stops[i];
          const b = stops[i + 1];
          const leg = route.stops.indexOf(a);
          if (route.moving && route.moving.leg === leg) {
            const f = route.moving.fraction;
            L.polyline(arc(a, b, 0, f), done).addTo(map);
            L.polyline(arc(a, b, f, 1), todo).addTo(map);
          } else {
            L.polyline(arc(a, b), leg < route.doneLegs ? done : todo).addTo(map);
          }
          bounds.push(...arc(a, b, 0, 1, 12));
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

        const pos = route.position;
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

        if (bounds.length === 1) map.setView(bounds[0], 5);
        else map.fitBounds(bounds, { padding: [36, 36], maxZoom: 6 });
        setReady(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
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
