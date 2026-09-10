import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

export interface MapPoint {
  lat: number | null | undefined;
  lon: number | null | undefined;
  label?: string | null;
}
export interface MapEvent {
  lat: number | null | undefined;
  lon: number | null | undefined;
  description?: string | null;
  occurred_at?: string | null;
  is_actual?: boolean;
}

interface Props {
  pol?: MapPoint | null;
  pod?: MapPoint | null;
  vessel?: (MapPoint & { at?: string | null }) | null;
  events?: MapEvent[];
  /** CSS height, default 320px. */
  height?: number;
}

function ok<T extends MapPoint>(
  p?: T | null,
): p is T & { lat: number; lon: number } {
  return !!p && typeof p.lat === "number" && typeof p.lon === "number";
}

/**
 * Leaflet map of a shipment's route — POL → milestone events → live vessel
 * position → POD. Leaflet + its CSS are loaded on demand so they stay out of
 * the main bundle. Falls back to a note when no coordinates are known yet.
 */
export default function TrackingMap({
  pol,
  pod,
  vessel,
  events = [],
  height = 320,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  const pts: { lat: number; lon: number }[] = [];
  if (ok(pol)) pts.push({ lat: pol.lat, lon: pol.lon });
  for (const e of events) {
    if (typeof e.lat === "number" && typeof e.lon === "number") {
      pts.push({ lat: e.lat, lon: e.lon });
    }
  }
  if (ok(vessel)) pts.push({ lat: vessel.lat, lon: vessel.lon });
  if (ok(pod)) pts.push({ lat: pod.lat, lon: pod.lon });

  const hasData = pts.length > 0;

  useEffect(() => {
    if (!hasData || !boxRef.current) return;
    let map: import("leaflet").Map | null = null;
    let cancelled = false;

    (async () => {
      try {
        const L = (await import("leaflet")).default;
        if (cancelled || !boxRef.current) return;

        map = L.map(boxRef.current, {
          scrollWheelZoom: false,
          attributionControl: true,
        });
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 18,
          attribution: "&copy; OpenStreetMap contributors",
        }).addTo(map);

        const dot = (color: string, r = 6) =>
          ({
            radius: r,
            color: "#fff",
            weight: 2,
            fillColor: color,
            fillOpacity: 1,
          }) as const;

        const line = pts.map((p) => [p.lat, p.lon] as [number, number]);
        if (line.length > 1) {
          L.polyline(line, {
            color: "#8cbc43",
            weight: 3,
            opacity: 0.9,
            dashArray: "1 6",
          }).addTo(map);
        }

        if (ok(pol)) {
          L.circleMarker([pol.lat, pol.lon], dot("#245bc6"))
            .addTo(map)
            .bindPopup(`Origin — ${pol.label ?? ""}`);
        }
        if (ok(pod)) {
          L.circleMarker([pod.lat, pod.lon], dot("#c0392b"))
            .addTo(map)
            .bindPopup(`Destination — ${pod.label ?? ""}`);
        }
        for (const e of events) {
          if (typeof e.lat !== "number" || typeof e.lon !== "number") continue;
          L.circleMarker([e.lat, e.lon], dot(e.is_actual ? "#8cbc43" : "#bbb", 4))
            .addTo(map)
            .bindPopup(
              `${e.description ?? "Event"}${
                e.occurred_at ? `<br>${new Date(e.occurred_at).toLocaleString()}` : ""
              }`,
            );
        }
        if (ok(vessel)) {
          const icon = L.divIcon({
            className: "trk-vessel",
            html: "🚢",
            iconSize: [22, 22],
            iconAnchor: [11, 11],
          });
          L.marker([vessel.lat, vessel.lon], { icon })
            .addTo(map)
            .bindPopup(
              `${vessel.label ?? "Vessel"}${
                vessel.at ? `<br>as of ${new Date(vessel.at).toLocaleString()}` : ""
              }`,
            );
        }

        map.fitBounds(line as [number, number][], { padding: [30, 30], maxZoom: 7 });
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
  }, [
    hasData,
    pol?.lat,
    pol?.lon,
    pod?.lat,
    pod?.lon,
    vessel?.lat,
    vessel?.lon,
    events.length,
  ]);

  if (!hasData || failed) {
    return (
      <div className="trk-map-empty" style={{ height }}>
        {failed
          ? "Map could not load."
          : "No position data yet — it appears once the carrier reports the first movement."}
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
