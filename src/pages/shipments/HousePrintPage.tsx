// Master shipment houses (0164): print the house bills (HBL on sea / road,
// HAWB on air / courier) and the master's cargo manifest, on the same
// layouts as the warehouse consolidations (WmsSeaDocs / WmsPrintPage), from
// the shipment and its houses.
//   /jobs/:id/houses/print/house          every house
//   /jobs/:id/houses/print/house?h=<id>   one house
//   /jobs/:id/houses/print/manifest       the master's manifest
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useJobs, useQuote } from "../../lib/hooks";
import { useCustomerConsignees, useCustomerShippers } from "../../lib/customers";
import { useJobHouses } from "../../lib/houses";
import type { ConsolMode, WmsConsol, WmsConsolHouse } from "../../lib/wms";
import { AwbSheet, ManifestSheet } from "../wms/WmsPrintPage";
import { HblSheet, SeaManifestSheet } from "../wms/WmsSeaDocs";

const isAir = (mode: string) => mode.startsWith("Air") || mode.startsWith("Courier");
const party = (...lines: (string | null | undefined)[]) => lines.map((l) => (l ?? "").trim()).filter(Boolean).join("\n");

export default function HousePrintPage() {
  const { id = "", doc = "house" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const jobsQ = useJobs();
  const job = (jobsQ.data ?? []).find((j) => j.id === id);
  const housesQ = useJobHouses(id);
  const shippersQ = useCustomerShippers(job?.client_id ?? undefined);
  const quoteQ = useQuote(job?.quote_id ?? undefined);
  const consigneesQ = useCustomerConsignees(job?.client_id ?? undefined);

  if (jobsQ.isLoading || housesQ.isLoading || shippersQ.isLoading || quoteQ.isLoading || consigneesQ.isLoading) return <div className="center-note">Loading…</div>;
  if (!job) return <div className="center-note">Shipment not found</div>;
  const houses = housesQ.data ?? [];
  if (houses.length === 0) return <div className="center-note">This shipment has no houses yet (add them on the shipment's View).</div>;

  const air = isAir(job.mode);
  const mode: ConsolMode = air ? "air" : job.mode.includes("FCL") ? "fcl" : "lcl";
  const shippers = new Map((shippersQ.data ?? []).map((s) => [s.id, s]));
  const client = job.client;
  const customer = party(client?.company, client?.address, client?.contact ? `Attn: ${client.contact}` : null, client?.phone || client?.company_phone ? `Tel: ${client?.phone || client?.company_phone}` : null);
  // The quote's pick from the customer's own consignees (0179) wins; the
  // customer then pays, so Accounting Information names the customer.
  const own = (consigneesQ.data ?? []).find((c) => c.id === quoteQ.data?.client_consignee_id);
  const consignee = own
    ? party(own.company, own.address, own.contact ? `Attn: ${own.contact}` : null, own.phone ? `Tel: ${own.phone}` : null)
    : customer;

  const consolHouses: WmsConsolHouse[] = houses.map((h) => {
    const s = h.supplier_id ? shippers.get(h.supplier_id) : undefined;
    const kg = Number(h.gross_kg) || 0;
    const cbm = Number(h.volume_cbm) || 0;
    return {
      id: h.id,
      position: h.position,
      house_no: h.house_no,
      client_id: job.client_id,
      shipper: party(s?.company, s?.address, s?.contact ? `Attn: ${s.contact}` : null, s?.phone ? `Tel: ${s.phone}` : null),
      consignee,
      accounting_info: own ? customer : "Same as consignee",
      nature_of_goods: h.commodity,
      handling_info: h.notes,
      marks: h.house_no,
      package_type: "PKGS",
      container_no: job.container_no,
      job_id: job.id,
      issued_by: "expac",
      pieces: Number(h.pieces) || 0,
      gross_kg: kg,
      chargeable_kg: air ? Math.max(kg, cbm * 167) : kg,
      volume_cbm: cbm,
      receipt_ids: [],
    };
  });

  const consol: WmsConsol = {
    id: job.id,
    consol_no: job.reference,
    mode,
    warehouse_id: null,
    job_id: job.id,
    status: "open",
    master_no: job.awb_mbl,
    carrier: air ? job.carrier_name : job.shipping_line,
    flight_no: null,
    flight_date: air ? job.etd : null,
    origin: job.origin,
    origin_name: job.origin,
    destination: job.destination,
    routing: [],
    shipper: party("EXPAC FORWARDING CC"),
    consignee,
    accounting_info: null,
    agent_name: "EXPAC FORWARDING CC",
    agent_iata: null,
    agent_account: null,
    currency: "ZAR",
    charges_code: "PP",
    declared_carriage: "NVD",
    declared_customs: "NCV",
    insurance: "NIL",
    handling_info: null,
    rate_class: null,
    rate_charge: null,
    total_charge: "AS AGREED",
    signed_by: null,
    executed_on: new Date().toISOString().slice(0, 10),
    executed_place: "Johannesburg",
    notes: null,
    vessel: job.vessel_name,
    voyage_no: null,
    place_of_receipt: job.origin,
    port_of_loading: job.origin,
    port_of_discharge: job.destination,
    place_of_delivery: job.destination,
    etd: job.etd,
    eta: job.eta,
    co_loader: null,
    containers: job.container_no ? [{ container_no: job.container_no, type: job.container_type ?? "", seal_no: "" }] : [],
    created_at: job.created_at,
    houses: consolHouses,
  };

  const only = params.get("h");
  const list = consolHouses.map((h, i) => ({ h, i })).filter(({ h }) => !only || h.id === only);

  return (
    <div className="qs-wrap">
      {doc === "manifest" ? (
        <style>{"@media print { @page { size: A4 landscape; margin: 8mm; } }"}</style>
      ) : (
        <style>{"@media print { @page { size: A4; margin: 8mm; } }"}</style>
      )}
      <div className="qs-toolbar">
        <button className="btn outline" onClick={() => navigate(-1)}>
          ← Back
        </button>
        <button className="btn" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>
      {doc === "manifest"
        ? air
          ? <ManifestSheet consol={consol} />
          : <SeaManifestSheet consol={consol} />
        : list.map(({ h, i }) =>
            air ? <AwbSheet key={h.id} consol={consol} house={h} index={i} /> : <HblSheet key={h.id} consol={consol} house={h} index={i} />,
          )}
    </div>
  );
}
