// Proof of delivery (migration 0151): the signed POD on a shipment (a
// shipment document of type "Proof of Delivery", shared with the customer)
// or on a Motion Warehouse release; optionally emailed to the customer.
import { supabase } from "./supabase";
import { sendMail } from "./mail";
import { EMAIL_BODY_STYLE, PUBLIC_APP_URL, emailButtonHtml } from "./mailStyle";
import { updateJob, uploadShipmentDocument } from "./db";
import { formatDate } from "./format";

export const POD_DOC_TYPE = "Proof of Delivery";

export interface PodInput {
  file: File;
  signedBy: string;
  deliveredAt: string; // yyyy-mm-dd
  email: boolean;
}

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function emailPod(opts: {
  to: string;
  greeting: string;
  subject: string;
  intro: string;
  signedBy: string;
  deliveredAt: string;
  file: File;
  jobId?: string;
  portalPath: string;
}) {
  const url = `${PUBLIC_APP_URL}${opts.portalPath}`;
  const facts = [opts.deliveredAt ? `Delivered: ${formatDate(opts.deliveredAt)}` : null, opts.signedBy ? `Signed for by: ${opts.signedBy}` : null]
    .filter(Boolean)
    .join("<br>");
  await sendMail({
    jobId: opts.jobId,
    to: [opts.to],
    subject: opts.subject,
    html:
      `<div style="${EMAIL_BODY_STYLE}"><p>Good day ${esc(opts.greeting)},</p><p>${esc(opts.intro)}</p>` +
      (facts ? `<p>${facts}</p>` : "") +
      `<p>The signed proof of delivery is attached, and on your portal.</p><p>${emailButtonHtml(url, "View in your portal")}</p>` +
      `<p>Kind regards,<br>ExPac Forwarding</p></div>`,
    text:
      `Good day ${opts.greeting},\n\n${opts.intro}\n` +
      (opts.deliveredAt ? `Delivered: ${formatDate(opts.deliveredAt)}\n` : "") +
      (opts.signedBy ? `Signed for by: ${opts.signedBy}\n` : "") +
      `\nThe signed proof of delivery is attached, and on your portal: ${url}\n\nKind regards,\nExPac Forwarding`,
    attachments: [{ filename: opts.file.name, content: await fileToBase64(opts.file) }],
  });
}

/** Shipment POD: shared document + who signed / when on the job (+ email). */
export async function saveShipmentPod(
  job: { id: string; reference: string; client?: { company?: string | null; email?: string | null; contact?: string | null } | null },
  pod: PodInput,
): Promise<{ emailed: boolean }> {
  await uploadShipmentDocument(job.id, pod.file, POD_DOC_TYPE, true);
  await updateJob(job.id, { pod_signed_by: pod.signedBy || null, pod_delivered_at: pod.deliveredAt || null });
  const to = job.client?.email;
  if (!pod.email || !to) return { emailed: false };
  await emailPod({
    to,
    greeting: job.client?.contact || job.client?.company || "",
    subject: `Delivered: ${job.reference}, proof of delivery`,
    intro: `Your shipment ${job.reference} has been delivered.`,
    signedBy: pod.signedBy,
    deliveredAt: pod.deliveredAt,
    file: pod.file,
    jobId: job.id,
    portalPath: "/portal/shipments",
  });
  return { emailed: true };
}

/** Motion Warehouse release POD: file on the release (+ email to its customer). */
export async function saveReleasePod(
  release: { id: string; release_no: string; client_id: string | null; deliver_to: string | null; lines: { receipt_id: string }[] },
  pod: PodInput,
): Promise<{ emailed: boolean }> {
  const path = `wms-pod/${release.id}/${Date.now()}-${pod.file.name.replace(/[^\w.\-]+/g, "_")}`;
  const up = await supabase.storage.from("shipment-documents").upload(path, pod.file, { upsert: false, contentType: pod.file.type || undefined });
  if (up.error) throw up.error;
  const { error } = await supabase
    .from("wms_releases")
    .update({ pod_path: path, pod_name: pod.file.name, pod_signed_by: pod.signedBy || null, pod_delivered_at: pod.deliveredAt || null })
    .eq("id", release.id);
  if (error) throw error;
  if (!pod.email) return { emailed: false };
  // The release's customer (or the customer of its receipts).
  let clientId = release.client_id;
  if (!clientId && release.lines[0]) {
    const { data } = await supabase.from("wms_receipts").select("client_id").eq("id", release.lines[0].receipt_id).maybeSingle();
    clientId = (data as { client_id: string | null } | null)?.client_id ?? null;
  }
  if (!clientId) return { emailed: false };
  const { data: c } = await supabase.from("clients").select("company, email, contact").eq("id", clientId).maybeSingle();
  const client = c as { company: string; email: string | null; contact: string | null } | null;
  if (!client?.email) return { emailed: false };
  await emailPod({
    to: client.email,
    greeting: client.contact || client.company,
    subject: `${release.deliver_to ? "Delivered" : "Collected"}: ${release.release_no}, proof of ${release.deliver_to ? "delivery" : "collection"}`,
    intro: `Your goods on release ${release.release_no} from the Motion Warehouse have been ${release.deliver_to ? "delivered" : "collected"}.`,
    signedBy: pod.signedBy,
    deliveredAt: pod.deliveredAt,
    file: pod.file,
    portalPath: "/portal/warehouse?view=releases",
  });
  return { emailed: true };
}
