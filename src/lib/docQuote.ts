// Motion AI: lead + quote from an uploaded commercial invoice or packing
// list. The document is read on the server (/api/ai-document-quote); the
// person checks the result, then the browser creates the lead (or uses a
// matching customer / lead) and saves a New Lead quote the same way the
// Quote Builder does.

import { supabase } from "./supabase";
import { getCompanySettings, saveLead, saveQuote } from "./db";
import { newReference } from "./format";
import { blankDraft, newPackingItem } from "./tierQuote";
import { applyTierMargins, LINE_CURRENCIES, type PackingItem, type QuoteDraft, type QuoteMode } from "./types";

export interface DocParty {
  company: string | null;
  contact: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  vat_no: string | null;
  import_code: string | null;
}

export interface DocPackingLine {
  qty: number | null;
  package_type: string | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  kg_each: number | null;
  description: string | null;
}

export interface DocQuoteExtraction {
  document_types: string[];
  buyer: DocParty;
  seller: DocParty;
  invoice_no: string | null;
  invoice_date: string | null;
  po_no: string | null;
  currency: string | null;
  incoterm: string | null;
  incoterm_place: string | null;
  origin: string | null;
  destination: string | null;
  mode_hint: "air" | "sea_fcl" | "sea_lcl" | "road" | "courier" | "unknown";
  container_type: string | null;
  commodity: string | null;
  invoice_total: number | null;
  packages: number | null;
  gross_kg: number | null;
  net_kg: number | null;
  cbm: number | null;
  packing: DocPackingLine[];
  warnings: string[];
  sources: string[];
}

export const DOC_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp";
const MAX_FILES = 4;
const MAX_BYTES = 15 * 1024 * 1024; // before base64 (+33%) so the request stays under 20 MB

function mediaType(f: File): string | null {
  const n = f.name.toLowerCase();
  if (f.type === "application/pdf" || n.endsWith(".pdf")) return "application/pdf";
  if (f.type === "image/jpeg" || /\.jpe?g$/.test(n)) return "image/jpeg";
  if (f.type === "image/png" || n.endsWith(".png")) return "image/png";
  if (f.type === "image/webp" || n.endsWith(".webp")) return "image/webp";
  return null;
}

function toBase64(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error(`Could not open ${f.name}`));
    r.readAsDataURL(f);
  });
}

/** Sends the files to Motion AI and returns what it read. */
export async function readShippingDocuments(files: File[]): Promise<DocQuoteExtraction> {
  if (!files.length) throw new Error("Choose a commercial invoice or packing list.");
  if (files.length > MAX_FILES) throw new Error(`Up to ${MAX_FILES} documents at a time.`);
  let total = 0;
  const payload: { name: string; media_type: string; data: string }[] = [];
  for (const f of files) {
    const media = mediaType(f);
    if (!media) throw new Error(`${f.name}: only PDFs and photos (JPG, PNG, WEBP) can be read.`);
    total += f.size;
    if (total > MAX_BYTES) throw new Error("The documents are too large together (15 MB max).");
    payload.push({ name: f.name, media_type: media, data: await toBase64(f) });
  }
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("You're signed out. Sign in again.");
  const res = await fetch("/api/ai-document-quote", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ files: payload }),
  });
  const raw = (await res.json().catch(() => ({}))) as DocQuoteExtraction & { error?: string };
  if (!res.ok) {
    if (res.status === 404 && !raw.error) throw new Error("Reading documents runs on the deployed site (no API here in dev).");
    throw new Error(raw.error || `Motion AI returned ${res.status}`);
  }
  return raw;
}

/* ---------- Matching an existing customer or lead ---------- */

export interface PartyMatch {
  kind: "client" | "lead";
  id: string;
  company: string;
  email: string | null;
}

/** Customers and leads whose company name looks like this one. */
export async function findPartyMatches(company: string): Promise<PartyMatch[]> {
  // Core words only ("ABC Trading (Pty) Ltd" -> "ABC Trading"), PostgREST-safe.
  const core = company
    .replace(/\b(pty|ltd|limited|inc|llc|co|cc|company|corp|corporation|gmbh|bv|sa|plc)\b\.?/gi, " ")
    .replace(/[^\p{L}\p{N} &-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (core.length < 3) return [];
  const pattern = `%${core.replace(/[%_]/g, "")}%`;
  const [c, l] = await Promise.all([
    supabase.from("clients").select("id,company,email").ilike("company", pattern).limit(5),
    supabase.from("leads").select("id,company,email,promoted_client_id").ilike("company", pattern).is("promoted_client_id", null).limit(5),
  ]);
  if (c.error) throw c.error;
  if (l.error) throw l.error;
  return [
    ...(c.data ?? []).map((r) => ({ kind: "client" as const, id: r.id, company: r.company, email: r.email })),
    ...(l.data ?? []).map((r) => ({ kind: "lead" as const, id: r.id, company: r.company, email: r.email })),
  ];
}

/* ---------- The editable form and creating the lead + quote ---------- */

export const QUOTE_MODES: QuoteMode[] = [
  "Air Freight (AIR)",
  "Air Freight (Consol)",
  "Courier Express (CX)",
  "Sea Freight (FCL)",
  "Sea Freight (LCL)",
  "Road Freight (RDX)",
];

export interface DocQuoteForm {
  /** Who ExPac's customer is on this shipment. */
  customerSide: "buyer" | "seller";
  customer: DocParty;
  /** "" = create a new lead; else an existing client or lead. */
  useExisting: "" | `client:${string}` | `lead:${string}`;
  mode: QuoteMode;
  origin: string;
  destination: string;
  incoterms: string;
  commodity: string;
  customer_reference: string;
  commercial_value: string;
  value_currency: string;
  packing: PackingItem[];
  /** Notes kept on the new lead (seller, invoice number, warnings). */
  notes: string;
}

function guessMode(x: DocQuoteExtraction): QuoteMode {
  switch (x.mode_hint) {
    case "air":
      return "Air Freight (AIR)";
    case "sea_fcl":
      return "Sea Freight (FCL)";
    case "sea_lcl":
      return "Sea Freight (LCL)";
    case "road":
      return "Road Freight (RDX)";
    case "courier":
      return "Courier Express (CX)";
    default:
      // No hint: small and light goes by air, the rest LCL. The person checks it.
      return (x.cbm ?? 0) > 2 || (x.gross_kg ?? 0) > 500 ? "Sea Freight (LCL)" : "Air Freight (AIR)";
  }
}

function packingFrom(x: DocQuoteExtraction): PackingItem[] {
  const rows = x.packing.filter((p) => (p.qty ?? 0) > 0 || (p.kg_each ?? 0) > 0 || (p.length_cm ?? 0) > 0);
  if (rows.length) {
    return rows.map((p, i) => ({
      ...newPackingItem(i),
      qty_ctns: p.qty || 1,
      length_cm: p.length_cm ?? 0,
      width_cm: p.width_cm ?? 0,
      height_cm: p.height_cm ?? 0,
      actual_kg: p.kg_each ?? 0,
    }));
  }
  // Only totals on the documents: one row, per-package averages.
  if (x.packages || x.gross_kg || x.cbm) {
    const qty = x.packages || 1;
    return [
      {
        ...newPackingItem(0),
        qty_ctns: qty,
        actual_kg: x.gross_kg ? Math.round((x.gross_kg / qty) * 100) / 100 : 0,
        cbm: x.cbm ? Math.round((x.cbm / qty) * 10000) / 10000 : "",
      },
    ];
  }
  return [newPackingItem(0)];
}

function partyLine(label: string, p: DocParty): string | null {
  const bits = [p.company, p.contact, p.email, p.phone, p.address].filter(Boolean);
  return bits.length ? `${label}: ${bits.join(", ")}` : null;
}

/** The review form, pre-filled from what Motion AI read. */
export function formFromExtraction(x: DocQuoteExtraction): DocQuoteForm {
  // ExPac is mostly import: the buyer is the customer unless only the seller is named.
  const side: "buyer" | "seller" = x.buyer.company || !x.seller.company ? "buyer" : "seller";
  const cur = (x.currency ?? "").toUpperCase();
  return {
    customerSide: side,
    customer: { ...(side === "buyer" ? x.buyer : x.seller) },
    useExisting: "",
    mode: guessMode(x),
    origin: x.origin ?? "",
    destination: x.destination ?? "",
    incoterms: [x.incoterm, x.incoterm_place].filter(Boolean).join(" "),
    commodity: x.commodity ?? "",
    customer_reference: x.po_no || x.invoice_no || "",
    commercial_value: x.invoice_total != null ? String(x.invoice_total) : "",
    value_currency: (LINE_CURRENCIES as string[]).includes(cur) ? cur : "USD",
    packing: packingFrom(x),
    notes: notesFor(x, side),
  };
}

export function notesFor(x: DocQuoteExtraction, side: "buyer" | "seller"): string {
  const other = side === "buyer" ? partyLine("Seller / shipper", x.seller) : partyLine("Buyer / consignee", x.buyer);
  return [
    `Created by Motion AI from ${x.sources.join(", ") || "an uploaded document"}.`,
    x.invoice_no ? `Invoice ${x.invoice_no}${x.invoice_date ? ` dated ${x.invoice_date}` : ""}.` : null,
    other,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Creates the lead (unless an existing customer / lead was chosen) and a
 *  New Lead quote with the route, value and packing. */
export async function createLeadAndQuote(f: DocQuoteForm): Promise<{ quote_id: string; reference: string; lead_id: string | null; client_id: string | null }> {
  let clientId: string | null = null;
  let leadId: string | null = null;
  if (f.useExisting.startsWith("client:")) clientId = f.useExisting.slice(7);
  else if (f.useExisting.startsWith("lead:")) leadId = f.useExisting.slice(5);
  else {
    const company = (f.customer.company ?? "").trim();
    if (!company) throw new Error("The customer needs a company name.");
    const { data: auth } = await supabase.auth.getUser();
    const lead = await saveLead(undefined, {
      company,
      contact: f.customer.contact?.trim() || null,
      email: f.customer.email?.trim() || null,
      phone: f.customer.phone?.trim() || null,
      address: f.customer.address?.trim() || null,
      vat_no: f.customer.vat_no?.trim() || null,
      import_code: f.customer.import_code?.trim() || null,
      source: "Motion AI document",
      notes: f.notes.trim() || null,
      sales_person_id: auth.user?.id ?? null,
    });
    leadId = lead.id;
  }

  const settings = await getCompanySettings();
  applyTierMargins(settings.tier_margins);
  const d: QuoteDraft = {
    ...blankDraft(),
    mode: f.mode,
    reference: newReference(f.mode),
    client_id: clientId ?? "",
    lead_id: clientId ? "" : (leadId ?? ""),
    origin: f.origin.trim(),
    destination: f.destination.trim(),
    commodity: f.commodity.trim() || "General Cargo",
    incoterms: f.incoterms.trim() || settings.default_incoterm || "",
    delivery_terms: "Door to Door",
    customer_reference: f.customer_reference.trim(),
    commercial_value: f.commercial_value.trim(),
    value_currency: f.value_currency || "ZAR",
    fx_usd_zar: String(settings.default_fx_usd_zar),
    fx_cny_zar: String(settings.default_fx_cny_zar),
    fx_eur_zar: String(settings.default_fx_eur_zar),
    fx_gbp_zar: String(settings.default_fx_gbp_zar ?? 0),
    packing: f.packing.length ? f.packing.map((p, i) => ({ ...p, position: i })) : [newPackingItem(0)],
  };
  const id = await saveQuote(d);
  // Marked like Motion AI's other quote drafts, so it shows as AI-made.
  const { error } = await supabase.from("quotes").update({ ai_draft: true }).eq("id", id);
  if (error && error.code !== "PGRST204" && error.code !== "42703") throw error;
  return { quote_id: id, reference: d.reference, lead_id: leadId, client_id: clientId };
}
