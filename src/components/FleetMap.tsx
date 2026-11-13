import { useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

/** One shipment on the fleet map: where it is now (vessel / flight), or
 *  else its port of loading / discharge. */
export interface FleetPoint {
  id: string;
  label: string;
  /** Extra lines for the popup (vessel, status, ETA). Never a source name. */
  lines: string[];
  lat: number;
  lon: number;
  /** "live": a real position; "port": only the port is known. */
  kind: "live" | "port";
  air?: boolean;
}

/**
 * Many shipments on one Leaflet map (Partner Portal dashboard / Tracking):
 * a dot per shipment, green when it's a live position, teal for a port,
 * popup with the shipment details. Leaflet loads on demand.
 */
export default function FleetMap({
  points,
  height = 340,
  onOpen,
}: {
  points: FleetPoint[];
  height?: number;
  onOpen?: (id: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const key = useMemo(() => JSON.stringify(points.map((p) => [p.id, p.lat.toFixed(2), p.lon.toFixed(2), p.kind])), [points]);
  const openRef = useRef(onOpen);
  openRef.current = onOpen;

  useEffect(() => {
    if (!box.current || points.length === 0) return;
    let map: import("leaflet").Map | null = null;
    let cancelled = false;
    let observer: ResizeObserver | null = null;
    (async () => {
      try {
        const L = (await import("leaflet")).default;
        if (cancelled || !box.current) return;
        map = L.map(box.current, { scrollWheelZoom: false, worldCopyJump: true });
        L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", {
          maxZoom: 18,
          attribution: "Tiles &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors",
        }).addTo(map);
        const bounds: [number, number][] = [];
        for (const p of points) {
          const m = L.circleMarker([p.lat, p.lon], {
            radius: p.kind === "live" ? 8 : 6,
            color: "#ffffff",
            weight: 2,
            fillColor: p.kind === "live" ? "#8cbc43" : "#02a5aa",
            fillOpacity: 0.95,
          }).addTo(map);
          const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
          m.bindPopup(
            `<b>${esc(p.label)}</b>${p.lines.map((l) => `<br>${esc(l)}`).join("")}` +
              (openRef.current ? `<br><a href="#" data-open="${esc(p.id)}">Open shipment</a>` : ""),
          );
          m.on("popupopen", (e) => {
            const a = (e.popup.getElement() as HTMLElement | undefined)?.querySelector<HTMLAnchorElement>("[data-open]");
            a?.addEventListener("click", (ev) => {
              ev.preventDefault();
              openRef.current?.(p.id);
            });
          });
          bounds.push([p.lat, p.lon]);
        }
        const fit = () => {
          if (!map) return;
          map.invalidateSize();
          if (bounds.length === 1) map.setView(bounds[0], 4);
          else map.fitBounds(bounds, { padding: [30, 30], maxZoom: 5 });
        };
        fit();
        // The box may only get its real size after layout settles.
        setTimeout(fit, 150);
        observer = new ResizeObserver(() => map?.invalidateSize());
        observer.observe(box.current);
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
  }, [key]);

  if (points.length === 0)
    return (
      <div className="fleet-map-empty" style={{ height }}>
        No positions yet. Shipments appear here once they are tracking.
      </div>
    );
  if (failed) return <div className="fleet-map-empty">The map could not load.</div>;
  return <div ref={box} className="fleet-map" style={{ height }} />;
}
