/** The maritime lane network packaged in searoute-js (src/lib/seaLanes.ts). */
declare module "searoute-js/data/marnet_densified.json" {
  const marnet: { features: { geometry: { coordinates: [number, number][] } }[] };
  export default marnet;
}
