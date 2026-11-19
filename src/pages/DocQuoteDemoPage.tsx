// DEV only: /dev/doc-quote, the "lead + quote from a document" review form
// with a sample read of a commercial invoice + packing list, to check its
// look without signing in or calling Motion AI.

import DocQuoteReview from "../components/DocQuoteReview";
import type { DocQuoteExtraction } from "../lib/docQuote";

const SAMPLE: DocQuoteExtraction = {
  document_types: ["Commercial invoice", "Packing list"],
  buyer: {
    company: "Karoo Pumps (Pty) Ltd",
    contact: "Thandi Mokoena",
    email: "thandi@karoopumps.example",
    phone: "+27 21 555 0142",
    address: "14 Voortrekker Rd, Bellville, Cape Town, South Africa",
    vat_no: "4123456789",
    import_code: "21234567",
  },
  seller: {
    company: "Ningbo Fluidtech Co., Ltd",
    contact: "Leo Chen",
    email: "sales@fluidtech.example",
    phone: "+86 574 5555 0188",
    address: "88 Jiangnan Rd, Ningbo, China",
    vat_no: null,
    import_code: null,
  },
  invoice_no: "NF-2026-1187",
  invoice_date: "2026-11-12",
  po_no: "KP-PO-0931",
  currency: "USD",
  incoterm: "FOB",
  incoterm_place: "Ningbo",
  origin: "Ningbo, China",
  destination: "Cape Town, South Africa",
  mode_hint: "unknown",
  container_type: null,
  commodity: "Stainless steel centrifugal pumps and spares",
  invoice_total: 18450,
  packages: 9,
  gross_kg: 1310,
  net_kg: 1180,
  cbm: 6.2,
  packing: [
    { qty: 6, package_type: "crate", length_cm: 120, width_cm: 80, height_cm: 95, kg_each: 185, description: "Pumps" },
    { qty: 3, package_type: "carton", length_cm: 60, width_cm: 40, height_cm: 45, kg_each: 66.7, description: "Spares" },
  ],
  warnings: ["Packing list gross weight (1,310 kg) differs from the invoice (1,290 kg)."],
  sources: ["NF-2026-1187 CI.pdf", "NF-2026-1187 PL.pdf"],
};

export default function DocQuoteDemoPage() {
  return (
    <div className="main">
      <DocQuoteReview
        extraction={SAMPLE}
        onClose={() => undefined}
        onCreated={() => undefined}
      />
    </div>
  );
}
