import marnet from "searoute-js/data/marnet_densified.json";

/**
 * Sea lanes for the tracking map when ShipsGo has no route for a shipment:
 * the shortest path between two ports over the maritime lane network
 * (Eurostat's MARNET, as packaged in searoute-js), so a sea leg goes round
 * the Cape or through Suez instead of straight over land.
 *
 * Only the network data comes from searoute-js; its own path finder breaks
 * under Vite, so the graph + Dijkstra are here. Loaded on demand by
 * TrackingMap (dynamic import), out of the main bundle.
 */

type LL = [number, number]; // [lat, lon]

interface Graph {
  pts: LL[];
  edges: { to: number; km: number }[][];
}

const toRad = (d: number) => (d * Math.PI) / 180;
function km(a: LL, b: LL): number {
  const h =
    Math.sin(toRad(b[0] - a[0]) / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(toRad(b[1] - a[1]) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

let graph: Graph | null = null;
function build(): Graph {
  if (graph) return graph;
  const index = new Map<string, number>();
  const pts: LL[] = [];
  const edges: { to: number; km: number }[][] = [];
  const node = (lon: number, lat: number) => {
    // ±180 is one meridian: both sides land on the same node.
    const key = `${Math.abs(lon) >= 179.9999 ? 180 : lon.toFixed(4)},${lat.toFixed(4)}`;
    let i = index.get(key);
    if (i === undefined) {
      i = pts.length;
      index.set(key, i);
      pts.push([lat, lon]);
      edges.push([]);
    }
    return i;
  };
  const fc = marnet as { features: { geometry: { coordinates: [number, number][] } }[] };
  for (const f of fc.features) {
    const line = f.geometry.coordinates;
    for (let k = 1; k < line.length; k++) {
      const a = node(line[k - 1][0], line[k - 1][1]);
      const b = node(line[k][0], line[k][1]);
      if (a === b) continue;
      const d = km(pts[a], pts[b]);
      edges[a].push({ to: b, km: d });
      edges[b].push({ to: a, km: d });
    }
  }
  graph = { pts, edges };
  return graph;
}

function nearest(g: Graph, p: LL): number {
  let best = 0;
  let bestKm = Infinity;
  g.pts.forEach((q, i) => {
    const d = km(p, q);
    if (d < bestKm) [best, bestKm] = [i, d];
  });
  return best;
}

/** Shortest sea path a -> b as [lat, lon] points (ports at both ends), or
 *  null when the lane network can't connect them. */
export function seaRoute(a: LL, b: LL): LL[] | null {
  const g = build();
  const from = nearest(g, a);
  const to = nearest(g, b);
  const dist = new Float64Array(g.pts.length).fill(Infinity);
  const prev = new Int32Array(g.pts.length).fill(-1);
  dist[from] = 0;
  // Binary heap of [distance, node].
  const heap: [number, number][] = [[0, from]];
  const push = (item: [number, number]) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (heap[up][0] <= heap[i][0]) break;
      [heap[up], heap[i]] = [heap[i], heap[up]];
      i = up;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, u] = pop();
    if (u === to) break;
    if (d > dist[u]) continue;
    for (const e of g.edges[u]) {
      const nd = d + e.km;
      if (nd < dist[e.to]) {
        dist[e.to] = nd;
        prev[e.to] = u;
        push([nd, e.to]);
      }
    }
  }
  if (from !== to && prev[to] === -1) return null;
  const path: LL[] = [];
  for (let u = to; u !== -1; u = prev[u]) path.push(g.pts[u]);
  path.reverse();
  return [a, ...path, b];
}
