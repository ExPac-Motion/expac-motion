/**
 * Attachments for Shipment Comms emails: the shipment's generated documents
 * (Booking Confirmation, Delivery Release Order, ... -- rendered from their
 * print page to PDF in the browser), files uploaded to its Document Vault,
 * and the linked customer quotation.
 */

import { getShipmentDocumentUrl } from "./db";
import { docName } from "./format";
import { buildQuotePdf, type QuoteAttachment } from "./quotePdf";
import type { ShipmentDocument } from "./types";

export type ShipmentAttachmentPick =
  | {
      key: string;
      label: string;
      kind: "generated";
      slug: string;
      title: string;
      jobId: string;
      reference: string;
    }
  | { key: string; label: string; kind: "file"; doc: ShipmentDocument }
  | { key: string; label: string; kind: "quote"; quoteId: string; reference: string }
  /** A file picked from the computer for this email only (not stored). */
  | { key: string; label: string; kind: "local"; file: File };

const LOAD_TIMEOUT_MS = 20_000;

/** Wait until the document print page has rendered its sheet (shipment +
 *  packing data loaded, images done). */
function waitForSheet(doc: Document): Promise<HTMLElement> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let lastHeight = -1;
    let stable = 0;
    const tick = () => {
      const err = doc.querySelector(".center-note");
      if (err && /not found|unknown/i.test(err.textContent || "")) {
        return reject(new Error(err.textContent || "Document not found"));
      }
      const sheet = doc.querySelector<HTMLElement>(".qs-sheet[data-ready]");
      const imgsReady = Array.from(doc.images).every(
        (img) => img.complete || img.getAttribute("src") == null,
      );
      const h = sheet?.scrollHeight ?? -1;
      if (sheet && imgsReady && h === lastHeight) {
        stable += 1;
        if (stable >= 2) return resolve(sheet);
      } else {
        stable = 0;
      }
      lastHeight = h;
      if (Date.now() - started > LOAD_TIMEOUT_MS) {
        const any = sheet ?? doc.querySelector<HTMLElement>(".qs-sheet");
        return any ? resolve(any) : reject(new Error("Document did not load in time"));
      }
      setTimeout(tick, 250);
    };
    tick();
  });
}

/** Render a generated shipment document (/jobs/:id/documents/:slug/print)
 *  to an A4 PDF. The sheet is one tall page on screen, so it's captured
 *  once and sliced into A4-height pages. */
export async function buildShipmentDocPdf(
  jobId: string,
  slug: string,
  title: string,
  reference: string,
): Promise<QuoteAttachment> {
  const [{ default: html2canvas }, jspdfMod] = await Promise.all([
    import("html2canvas-pro"),
    import("jspdf"),
  ]);
  const JsPDF = jspdfMod.jsPDF;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText =
    "position:fixed;left:-10000px;top:0;width:900px;height:1400px;border:0;visibility:visible;";
  iframe.src = `/jobs/${encodeURIComponent(jobId)}/documents/${encodeURIComponent(slug)}/print`;
  document.body.appendChild(iframe);

  try {
    await new Promise<void>((res, rej) => {
      iframe.addEventListener("load", () => res(), { once: true });
      iframe.addEventListener("error", () => rej(new Error(`Could not open ${title}`)), {
        once: true,
      });
    });
    const doc = iframe.contentDocument;
    if (!doc) throw new Error(`Could not read ${title}`);
    const sheet = await waitForSheet(doc);

    const canvas = await html2canvas(sheet, {
      scale: 3,
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
      windowWidth: doc.documentElement.scrollWidth,
    });

    const pdf = new JsPDF({ unit: "pt", format: "a4", compress: true });
    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();
    // Canvas pixels that make up one A4 page at full width.
    const sliceH = Math.floor((canvas.width * ph) / pw);
    const pages = Math.max(1, Math.ceil(canvas.height / sliceH));
    for (let i = 0; i < pages; i++) {
      const h = Math.min(sliceH, canvas.height - i * sliceH);
      const part = document.createElement("canvas");
      part.width = canvas.width;
      part.height = h;
      const ctx = part.getContext("2d");
      if (!ctx) throw new Error("Could not draw the document");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, part.width, part.height);
      ctx.drawImage(canvas, 0, i * sliceH, canvas.width, h, 0, 0, canvas.width, h);
      if (i > 0) pdf.addPage();
      pdf.addImage(part.toDataURL("image/png"), "PNG", 0, 0, pw, (h * pw) / canvas.width);
    }
    const uri = pdf.output("datauristring");
    return {
      filename: `${docName(title, reference)}.pdf`,
      content: uri.slice(uri.indexOf(",") + 1),
    };
  } finally {
    iframe.remove();
  }
}

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** Download a Document Vault file and return it as a mail attachment. */
export async function fetchStoredDocument(doc: ShipmentDocument): Promise<QuoteAttachment> {
  const url = await getShipmentDocumentUrl(doc.storage_path);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download ${doc.name}`);
  return { filename: doc.name, content: bufferToBase64(await res.arrayBuffer()) };
}

/** Build every picked attachment, in order. */
export async function resolveShipmentAttachments(
  picks: ShipmentAttachmentPick[],
): Promise<QuoteAttachment[]> {
  const out: QuoteAttachment[] = [];
  for (const p of picks) {
    if (p.kind === "generated") {
      out.push(await buildShipmentDocPdf(p.jobId, p.slug, p.title, p.reference));
    } else if (p.kind === "file") {
      out.push(await fetchStoredDocument(p.doc));
    } else if (p.kind === "local") {
      out.push({
        filename: p.file.name,
        content: bufferToBase64(await p.file.arrayBuffer()),
      });
    } else {
      out.push(await buildQuotePdf(p.quoteId, p.reference));
    }
  }
  return out;
}
