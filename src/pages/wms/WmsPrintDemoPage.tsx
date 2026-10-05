import { useSearchParams } from "react-router-dom";
import type { WmsConsol } from "../../lib/wms";
import { EXPAC_NOTIFY } from "./WmsConsols";
import { AwbSheet, ManifestSheet } from "./WmsPrintPage";
import { HblSheet, SeaManifestSheet } from "./WmsSeaDocs";

/** DEV only (/dev/wms-print?doc=mawb|hawb|manifest): the air waybill layouts
 *  on sample data, for checking against ExPac's Excel template. */
const DEMO: WmsConsol = {
  id: "demo",
  consol_no: "CN000001",
  mode: "air",
  warehouse_id: null,
  job_id: null,
  status: "open",
  master_no: "160-12345675",
  carrier: "CATHAY PACIFIC",
  flight_no: "CX749",
  flight_date: "2026-10-08",
  origin: "HKG",
  origin_name: "HONG KONG",
  destination: "JNB",
  routing: [{ to: "JNB", by: "CX" }],
  shipper: "SHENZHEN ROCKET INTERNATIONAL LOGISTICS LTD\nRM 1201, BLOCK A, SHENZHEN, CHINA\nTEL: +86 755 0000 0000",
  consignee: "EXPAC FORWARDING CC\nECO PARK BLVD, WITCH-HAZEL AVE, HIGHVELD\nCENTURION, 0144, SOUTH AFRICA",
  accounting_info: "FREIGHT COLLECT\nNOTIFY PARTY: DDU EXPRESS SA\nADD: SPARTAN, 1620, GAUTENG, SOUTH AFRICA\nTEL: +27 (0) 11 036 8703",
  agent_name: "SHENZHEN ROCKET INTERNATIONAL LOGISTICS LTD, SHENZHEN",
  agent_iata: "",
  agent_account: "",
  currency: "USD",
  charges_code: "CC",
  declared_carriage: "NVD",
  declared_customs: "NCV",
  insurance: "NIL",
  handling_info: null,
  rate_class: "K",
  rate_charge: null,
  total_charge: "AS AGREED",
  signed_by: "SHENZHEN ROCKET INTERNATIONAL LOGISTICS LTD",
  executed_on: "2026-10-07",
  executed_place: "HKG",
  notes: null,
  created_at: "2026-10-05",
  houses: [
    {
      position: 0,
      house_no: "SZR2610001",
      client_id: null,
      shipper: "GUANGZHOU BRIGHT LIGHTING CO LTD\nGUANGZHOU, CHINA",
      consignee: "ACME TRADING (PTY) LTD\n12 MAIN ROAD, MIDRAND, 1685\nTEL: +27 11 000 0000",
      accounting_info: EXPAC_NOTIFY,
      nature_of_goods: "LED LIGHTING FITTINGS\n1 CTN 60x40x40 CM",
      handling_info: null,
      pieces: 1,
      gross_kg: 76,
      chargeable_kg: 76,
      volume_cbm: 0.096,
      receipt_ids: [],
    },
    {
      position: 1,
      house_no: "SZR2610002",
      client_id: null,
      shipper: "NINGBO TOOLS CO\nNINGBO, CHINA",
      consignee: "BUILDRITE SUPPLIES\nPRETORIA, 0001",
      accounting_info: EXPAC_NOTIFY,
      nature_of_goods: "HAND TOOLS",
      handling_info: null,
      pieces: 12,
      gross_kg: 340.5,
      chargeable_kg: 410,
      volume_cbm: 2.45,
      receipt_ids: [],
    },
  ],
};

const SEA: WmsConsol = {
  ...DEMO,
  mode: "lcl",
  consol_no: "CN000002",
  master_no: "MEDUSH123456",
  carrier: "MSC",
  vessel: "MSC ANNA",
  voyage_no: "FA542A",
  place_of_receipt: "SHANGHAI CFS",
  port_of_loading: "CNSHA",
  port_of_discharge: "ZADUR",
  place_of_delivery: "JOHANNESBURG CFS",
  etd: "2026-10-12",
  eta: "2026-11-08",
  co_loader: "SHANGHAI CONSOL LINES",
  containers: [{ container_no: "MSCU1234567", type: "40HC", seal_no: "ML123456" }],
  houses: DEMO.houses.map((h) => ({ ...h, container_no: "MSCU1234567", marks: "ACME / JHB\nC/NO 1-12", package_type: "Cartons" })),
};

export default function WmsPrintDemoPage() {
  const [params] = useSearchParams();
  const doc = params.get("doc") ?? "mawb";
  return (
    <div className="qs-wrap">
      {doc === "hbl" ? (
        <HblSheet consol={SEA} house={SEA.houses[0]} index={0} />
      ) : doc === "sea-manifest" ? (
        <SeaManifestSheet consol={SEA} />
      ) : doc === "manifest" ? (
        <ManifestSheet consol={DEMO} />
      ) : doc === "hawb" ? (
        <AwbSheet consol={DEMO} house={DEMO.houses[0]} index={0} />
      ) : (
        <AwbSheet consol={DEMO} />
      )}
    </div>
  );
}
