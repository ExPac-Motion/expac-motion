// Warehouse emails to the customer (migration 0149): one email per stage per
// receipt — received, checked, being prepared for shipping, shipped — with a
// button to the portal's Warehouse. wms_receipts.notified remembers what
// went out, so a stage is never emailed twice; clients.wms_notify = false
// switches a customer off. Sending never blocks the warehouse action.
import { supabase } from "./supabase";
import { sendMail } from "./mail";
import { EMAIL_BODY_STYLE, PUBLIC_APP_URL, emailButtonHtml } from "./mailStyle";
import { formatDate } from "./format";

export type WmsNoticeStage = "received" | "checked" | "preparing" | "shipped";

interface Row {
  id: string;
  receipt_no: string;
  client_id: string | null;
  job_id: string | null;
  description: string | null;
  pieces: number;
  on_hand: number;
  gross_kg: number;
  volume_cbm: number;
  received_at: string;
  notified: Record<string, string> | null;
  condition: string;
  condition_notes: string | null;
}
interface ClientRow {
  id: string;
  company: string;
  email: string | null;
  contact: string | null;
  contact_salutation: string | null;
  contact_last_name: string | null;
  wms_notify: boolean | null;
}

const SUBJECT: Record<WmsNoticeStage, string> = {
  received: "Goods received at the Motion Warehouse",
  checked: "Your goods have been checked",
  preparing: "Your goods are being prepared for shipping",
  shipped: "Your goods have shipped",
};
const INTRO: Record<WmsNoticeStage, string> = {
  received: "We've received the goods below into the Motion Warehouse. Photos and details are on your portal.",
  checked: "The goods below have been checked and measured in our warehouse.",
  preparing: "The goods below are being prepared for shipping.",
  shipped: "The goods below have left the Motion Warehouse.",
};

const CONDITION_TEXT: Record<string, string> = { damaged: "Damaged", wet: "Wet", short: "Short delivered", over: "Over delivered", repacked: "Repacked" };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Email the customer(s) of these receipts about a stage, once per receipt.
 * `detail` adds a line per receipt (consolidation / shipment number).
 * Returns how many emails went out; never throws.
 */
export async function notifyWms(stage: WmsNoticeStage, receiptIds: string[], detail: Record<string, string> = {}): Promise<number> {
  try {
    const ids = [...new Set(receiptIds)].filter(Boolean);
    if (ids.length === 0) return 0;
    const { data: recs } = await supabase
      .from("wms_receipts_v")
      .select("id, receipt_no, client_id, job_id, description, pieces, on_hand, gross_kg, volume_cbm, received_at, notified, condition, condition_notes")
      .in("id", ids);
    let rows = ((recs ?? []) as Row[]).filter((r) => r.client_id && !(r.notified ?? {})[stage]);
    // "Shipped" = nothing of the receipt left in store.
    if (stage === "shipped") rows = rows.filter((r) => Number(r.on_hand) <= 0);
    if (rows.length === 0) return 0;

    // Shipment number fallback: the receipt's own shipment.
    const jobIds = [...new Set(rows.map((r) => r.job_id).filter(Boolean))] as string[];
    const jobRef = new Map<string, string>();
    if (jobIds.length) {
      const { data: jobs } = await supabase.from("jobs").select("id, reference").in("id", jobIds);
      for (const j of (jobs ?? []) as { id: string; reference: string }[]) jobRef.set(j.id, j.reference);
    }

    const clientIds = [...new Set(rows.map((r) => r.client_id as string))];
    const { data: clients } = await supabase
      .from("clients")
      .select("id, company, email, contact, contact_salutation, contact_last_name, wms_notify")
      .in("id", clientIds);
    let sent = 0;
    for (const c of (clients ?? []) as ClientRow[]) {
      if (c.wms_notify === false || !c.email) continue;
      const mine = rows.filter((r) => r.client_id === c.id);
      if (mine.length === 0) continue;
      const who = [c.contact_salutation, c.contact_last_name].filter(Boolean).join(" ") || c.contact || c.company;
      const line = (r: Row) => {
        const exception =
          stage === "received" && r.condition && r.condition !== "good"
            ? `Exception: ${CONDITION_TEXT[r.condition] ?? r.condition}${r.condition_notes ? `, ${r.condition_notes}` : ""}`
            : "";
        const extra =
          detail[r.id] || exception || (stage === "shipped" && r.job_id && jobRef.get(r.job_id) ? `Shipment ${jobRef.get(r.job_id)}` : "");
        return { r, extra };
      };
      const items = mine.map(line);
      const url = `${PUBLIC_APP_URL}/portal/warehouse?view=overview`;
      const table =
        `<table cellpadding="6" style="border-collapse:collapse;margin:8px 0;font-size:10pt">` +
        `<tr style="background:#f4f1ea"><th align="left">Receipt</th><th align="left">Description</th><th align="left">Pieces</th><th align="left">Received</th>${
          items.some((i) => i.extra) ? '<th align="left">Details</th>' : ""
        }</tr>` +
        items
          .map(
            ({ r, extra }) =>
              `<tr style="border-top:1px solid #e5e5e5"><td><b>${esc(r.receipt_no)}</b></td><td>${esc(r.description || "")}</td><td>${r.pieces}</td><td>${formatDate(r.received_at)}</td>${
                items.some((i) => i.extra) ? `<td>${esc(extra)}</td>` : ""
              }</tr>`,
          )
          .join("") +
        `</table>`;
      const nos = mine.map((r) => r.receipt_no).join(", ");
      const hasException = stage === "received" && mine.some((r) => r.condition && r.condition !== "good");
      const exceptionNote = hasException
        ? "<p><b>Some goods arrived with an exception.</b> Please review the photos and acknowledge it on your portal (Warehouse, Exceptions).</p>"
        : "";
      const shipNo = stage === "shipped" ? items.map((i) => i.extra).find(Boolean) : "";
      await sendMail({
        to: [c.email],
        subject: `${SUBJECT[stage]}: ${nos}${shipNo ? `, ${shipNo}` : ""}`,
        html:
          `<div style="${EMAIL_BODY_STYLE}"><p>Good day ${esc(who)},</p><p>${INTRO[stage]}</p>${table}${exceptionNote}` +
          `<p>${emailButtonHtml(url, "View in your portal")}</p><p>Kind regards,<br>ExPac Forwarding</p></div>`,
        text:
          `Good day ${who},\n\n${INTRO[stage]}\n\n` +
          items.map(({ r, extra }) => `${r.receipt_no}  ${r.description ?? ""}  ${r.pieces} pcs${extra ? `  ${extra}` : ""}`).join("\n") +
          `\n\nView in your portal: ${url}\n\nKind regards,\nExPac Forwarding`,
      });
      const at = new Date().toISOString();
      for (const r of mine) {
        await supabase.from("wms_receipts").update({ notified: { ...(r.notified ?? {}), [stage]: at } }).eq("id", r.id);
      }
      sent++;
    }
    return sent;
  } catch {
    return 0;
  }
}
