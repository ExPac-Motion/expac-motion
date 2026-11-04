// Draft actions (stage 3, 0217): a quotation from the tariff sheet, and an
// email to a customer / supplier / partner. Both finish in the browser:
//   draft_quote  -> priced with the Quote Builder's own "Load rates" code
//                   (src/lib/aiQuote.ts) and saved as a New Lead quote
//   draft_email  -> opened in Quick Mail with the signature; a person sends
// so the server only prepares them; the app reports back with "complete".

import type { ActionTool, ToolContext } from "./types.ts";

export const QUOTE_MODES = [
  "Air Freight (AIR)",
  "Air Freight (Consol)",
  "Courier Express (CX)",
  "Sea Freight (FCL)",
  "Sea Freight (LCL)",
  "Road Freight (RDX)",
];

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Plain paragraphs -> simple email HTML. */
function toHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

// ---------- quotation ----------

async function findParty(ctx: ToolContext, name: string) {
  const p = `%${name.replace(/[%,()]/g, " ").trim()}%`;
  const [{ data: clients }, { data: leads }] = await Promise.all([
    ctx.db.from("clients").select("id,company,rate_tier").ilike("company", p).limit(3),
    ctx.db.from("leads").select("id,company").ilike("company", p).is("promoted_client_id", null).limit(3),
  ]);
  if (clients?.length === 1) return { client_id: clients[0].id, company: clients[0].company, tier: clients[0].rate_tier as string | null };
  if (clients && clients.length > 1) throw new Error(`More than one customer matches "${name}": ${clients.map((c) => c.company).join(", ")}.`);
  if (leads?.length === 1) return { lead_id: leads[0].id, company: leads[0].company, tier: null };
  if (leads && leads.length > 1) throw new Error(`More than one lead matches "${name}": ${leads.map((c) => c.company).join(", ")}.`);
  throw new Error(`No customer or lead matching "${name}". Add them first, or give the exact name.`);
}

export const draftQuote: ActionTool = {
  name: "draft_quote",
  kind: "action",
  runsIn: "browser",
  description:
    "Draft a quotation from the Rates & Tariff Sheet, saved as a New Lead quote for a person to review and send. Needs the customer (or lead), mode, origin and destination; the packing list (cartons, size, weight) is needed for weight-based rates. Uses the customer's rate tier and the matching trade-route sheet. Goes through the action's autonomy level. Never quote prices to the user as final; the saved quote is the draft.",
  input_schema: {
    type: "object",
    properties: {
      customer_name: { type: "string", description: "Customer or lead company name." },
      mode: { type: "string", enum: QUOTE_MODES },
      origin: { type: "string", description: "Origin port / city / country." },
      destination: { type: "string", description: "Destination port / city." },
      commodity: { type: "string" },
      incoterms: { type: "string", description: "e.g. EXW, FOB, CIF, DAP; optional." },
      customer_reference: { type: "string", description: "Customer's own reference / PO, optional." },
      rate_tier: { type: "string", enum: ["platinum", "gold", "silver"], description: "Only to override the customer's tier." },
      packing: {
        type: "array",
        description: "Packing list lines.",
        items: {
          type: "object",
          properties: {
            qty_ctns: { type: "number", description: "Number of cartons / pieces." },
            length_cm: { type: "number" },
            width_cm: { type: "number" },
            height_cm: { type: "number" },
            actual_kg: { type: "number", description: "Weight of ONE carton / piece, kg." },
          },
          additionalProperties: false,
        },
      },
    },
    required: ["customer_name", "mode", "origin", "destination"],
    additionalProperties: false,
  },
  async prepare(ctx, input) {
    const mode = str(input.mode);
    if (!QUOTE_MODES.includes(mode)) throw new Error(`"${mode}" is not a quote mode.`);
    const party = await findParty(ctx, str(input.customer_name));
    const origin = str(input.origin);
    const destination = str(input.destination);
    const tier = str(input.rate_tier) || party.tier || "silver";

    // The trade-route sheet for this tier + mode that matches the lane.
    let sheet: { id: string; route: string; tier: string } | null = null;
    const { data: sheets, error } = await ctx.db
      .from("tariff_sheets")
      .select("id,route,tier,mode,origin,destination")
      .eq("mode", mode)
      .ilike("tier", tier);
    if (!error && sheets?.length) {
      const has = (s: Record<string, string | null>, n: string) =>
        !n || [s.route, s.origin, s.destination].some((h) => (h ?? "").toLowerCase().includes(n.toLowerCase()));
      const score = (s: Record<string, string | null>) => (has(s, origin) ? 2 : 0) + (has(s, destination) ? 1 : 0);
      const best = [...sheets].sort((a, b) => score(b) - score(a))[0];
      if (best && score(best) > 0) sheet = { id: best.id, route: best.route, tier: best.tier };
    }

    const packing = (Array.isArray(input.packing) ? input.packing : [])
      .map((p: Record<string, unknown>) => ({
        qty_ctns: num(p.qty_ctns) || 1,
        length_cm: num(p.length_cm),
        width_cm: num(p.width_cm),
        height_cm: num(p.height_cm),
        actual_kg: num(p.actual_kg),
      }))
      .slice(0, 50);
    const pcs = packing.reduce((a, p) => a + p.qty_ctns, 0);
    const kg = packing.reduce((a, p) => a + p.qty_ctns * p.actual_kg, 0);

    const out: Record<string, unknown> = {
      ...(party.client_id ? { client_id: party.client_id } : { lead_id: party.lead_id }),
      company_label: party.company,
      mode,
      origin,
      destination,
      commodity: str(input.commodity) || undefined,
      incoterms: str(input.incoterms).toUpperCase() || undefined,
      customer_reference: str(input.customer_reference) || undefined,
      rate_tier: sheet?.tier ?? tier,
      tariff_sheet_id: sheet?.id,
      route_label: sheet?.route,
      packing,
    };
    const tierName = String(out.rate_tier).replace(/^./, (c) => c.toUpperCase());
    const summary =
      `Draft ${mode} quote for ${party.company}, ${origin} to ${destination}` +
      (packing.length ? `, ${pcs} pcs ${Math.round(kg)} kg` : ", no packing list yet") +
      (sheet ? `, ${tierName} rates (${sheet.route})` : ", no matching tariff sheet: charge lines left blank");
    return { input: out, summary, target_type: party.client_id ? "client" : "lead", target_id: party.client_id ?? party.lead_id ?? null, target_ref: party.company };
  },
  applyEdit(stored) {
    return { input: stored, summary: "" };
  },
  async execute() {
    throw new Error("A quote draft is priced and saved in the app; use Approve on the card.");
  },
  async revert(ctx, undo) {
    // Only an AI draft nobody has moved on (still New Lead).
    const { data, error } = await ctx.svc
      .from("quotes")
      .delete()
      .eq("id", String(undo.quote_id))
      .eq("status", "open")
      .eq("ai_draft", true)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("That quote has moved on (sent, accepted or edited), so it stays.");
    return { removed: undo.quote_id };
  },
};

// ---------- email ----------

const PARTY_TABLES: Record<string, string> = {
  customer: "clients",
  lead: "leads",
  vendor: "suppliers",
  agent: "agents",
  transporter: "transporters",
  clearing_agent: "clearing_agents",
  destination_agent: "destination_agents",
};

export const draftEmail: ActionTool = {
  name: "draft_email",
  kind: "action",
  runsIn: "browser",
  description:
    "Draft an email to a customer, lead, vendor or partner (agent, transporter, clearing or destination agent), e.g. a shipment update, document request or quote follow-up. Always needs a person to review and press Send; it is never sent automatically. Write the body as plain paragraphs (no signature: the saved signature is added). Link it to a shipment or quote when it is about one.",
  input_schema: {
    type: "object",
    properties: {
      recipient_kind: { type: "string", enum: Object.keys(PARTY_TABLES) },
      recipient_name: { type: "string", description: "Company name. Leave empty when the shipment's customer is meant." },
      to_email: { type: "string", description: "Only when the user gave a specific address." },
      shipment_reference: { type: "string", description: "Shipment this is about, optional." },
      quote_reference: { type: "string", description: "Quote this is about, optional." },
      subject: { type: "string" },
      body: { type: "string", description: "Plain text, paragraphs separated by a blank line. Greeting included, no signature." },
    },
    required: ["recipient_kind", "subject", "body"],
    additionalProperties: false,
  },
  async prepare(ctx, input) {
    const kind = str(input.recipient_kind);
    const table = PARTY_TABLES[kind];
    if (!table) throw new Error(`Unknown recipient kind "${kind}".`);
    const subject = str(input.subject).slice(0, 200);
    const body = str(input.body).slice(0, 8000);
    if (!subject || !body) throw new Error("A subject and a body are required.");

    const out: Record<string, unknown> = { recipient_kind: kind, subject, body_html: toHtml(body) };
    let company = "";
    let contact = "";
    let email = str(input.to_email);

    const sref = str(input.shipment_reference);
    if (sref) {
      const { data: job } = await ctx.db
        .from("jobs")
        .select("id,reference,client_id,supplier_id,quote_id")
        .ilike("reference", sref)
        .maybeSingle();
      if (!job) throw new Error(`No shipment numbered ${sref}.`);
      out.job_id = job.id;
      out.reference = job.reference;
      if (job.quote_id) out.quote_id = job.quote_id;
      if (!str(input.recipient_name) && (kind === "customer" || kind === "vendor")) {
        const id = kind === "customer" ? job.client_id : job.supplier_id;
        if (id) {
          const { data: p } = await ctx.db.from(table).select("id,company,contact,email").eq("id", id).single();
          if (p) {
            company = p.company;
            contact = p.contact ?? "";
            email ||= p.email ?? "";
            out.party_id = p.id;
          }
        }
      }
    }
    const qref = str(input.quote_reference);
    if (qref && !out.quote_id) {
      const { data: q } = await ctx.db.from("quotes").select("id,reference").ilike("reference", qref).maybeSingle();
      if (!q) throw new Error(`No quote numbered ${qref}.`);
      out.quote_id = q.id;
      out.reference ??= q.reference;
    }
    const name = str(input.recipient_name);
    if (name && !company) {
      const { data } = await ctx.db
        .from(table)
        .select("id,company,contact,email")
        .ilike("company", `%${name.replace(/[%,()]/g, " ")}%`)
        .limit(3);
      if (!data?.length) throw new Error(`No ${kind.replace("_", " ")} matching "${name}".`);
      if (data.length > 1) throw new Error(`More than one ${kind.replace("_", " ")} matches "${name}": ${data.map((d) => d.company).join(", ")}.`);
      company = data[0].company;
      contact = data[0].contact ?? "";
      email ||= data[0].email ?? "";
      out.party_id = data[0].id;
    }
    if (!company && !email) throw new Error("Who is it to? Give a company name or a shipment number.");
    out.company_label = company || email;
    out.contact_label = contact || undefined;
    out.to = email || undefined;
    return {
      input: out,
      summary: `Email to ${company || email}${email ? ` (${email})` : " (no email address on file)"}: "${subject}"`,
      target_type: out.job_id ? "job" : out.quote_id ? "quote" : kind,
      target_id: (out.job_id ?? out.quote_id ?? out.party_id ?? null) as string | null,
      target_ref: (out.reference as string) ?? company,
    };
  },
  applyEdit(stored) {
    return { input: stored, summary: "" };
  },
  async execute() {
    throw new Error("Emails are sent from the app; use Approve & send on the card.");
  },
};

export const DRAFT_TOOLS: ActionTool[] = [draftQuote, draftEmail];
