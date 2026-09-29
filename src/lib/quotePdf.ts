/**
 * Client-side PDF of the customer quotation, for attaching to a Quick Mail.
 *
 * The signed-off print layout (`/quotes/:id/print`, the LOCKED `.qs-*` sheet)
 * is rendered in a hidden same-origin iframe, each `.qs-page` is rasterised
 * with html2canvas and dropped onto an A4 page in jsPDF. Heavy deps are loaded
 * on demand so they stay out of the main bundle.
 */

import { docName } from "./format";

export interface QuoteAttachment {
  filename: string;
  /** base64 PDF, no data: prefix — the shape functions/api/send-mail wants. */
  content: string;
}

const LOAD_TIMEOUT_MS = 20_000;

function waitForPages(doc: Document): Promise<HTMLElement[]> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let lastCount = -1;
    let stable = 0;

    const tick = () => {
      const err = doc.querySelector(".center-note");
      if (err && /not found|error/i.test(err.textContent || "")) {
        return reject(new Error(err.textContent || "Quotation not found"));
      }
      const pages = Array.from(
        doc.querySelectorAll<HTMLElement>(".qs-pageset .qs-page"),
      );
      const imgsReady = Array.from(doc.images).every(
        (img) => img.complete || img.getAttribute("src") == null,
      );

      if (pages.length > 0 && imgsReady && pages.length === lastCount) {
        stable += 1;
        // two identical polls in a row = pagination has settled
        if (stable >= 2) return resolve(pages);
      } else {
        stable = 0;
      }
      lastCount = pages.length;

      if (Date.now() - started > LOAD_TIMEOUT_MS) {
        return pages.length > 0
          ? resolve(pages)
          : reject(new Error("Quotation preview did not load in time"));
      }
      setTimeout(tick, 250);
    };

    tick();
  });
}

/**
 * Build a PDF of the given quote. Runs entirely in the browser; the iframe
 * reuses the current login so no extra auth is needed.
 */
export async function buildQuotePdf(
  quoteId: string,
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
  iframe.src = `/quotes/${encodeURIComponent(quoteId)}/print`;
  document.body.appendChild(iframe);

  try {
    await new Promise<void>((res, rej) => {
      iframe.addEventListener("load", () => res(), { once: true });
      iframe.addEventListener(
        "error",
        () => rej(new Error("Could not open the quotation preview")),
        { once: true },
      );
    });

    const doc = iframe.contentDocument;
    if (!doc) throw new Error("Could not read the quotation preview");

    const pages = await waitForPages(doc);

    const pdf = new JsPDF({ unit: "pt", format: "a4", compress: true });
    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();

    for (let i = 0; i < pages.length; i++) {
      const canvas = await html2canvas(pages[i], {
        // 3x is close to print quality (~300dpi) at A4 width — 2x (~200dpi)
        // read soft once zoomed past 100%, which is what this is fixing.
        scale: 3,
        backgroundColor: "#ffffff",
        useCORS: true,
        logging: false,
        windowWidth: doc.documentElement.scrollWidth,
      });
      // PNG, not JPEG — this page is text/tables/lines, not a photo. JPEG's
      // lossy chroma-subsampled compression blurs/rings right around sharp
      // edges like letterforms and table borders; PNG is lossless and
      // actually compresses this kind of flat-color content well.
      const img = canvas.toDataURL("image/png");
      // `.qs-page` is a screen-mode box (CSS min-height: 278mm) that's
      // deliberately shorter than a full A4 sheet (297mm) — on the real
      // print/download path the browser's own @page margin makes up that
      // difference. There's no such margin here, so fit the image to the
      // full page in both dimensions rather than just the width: capping
      // the height to the captured aspect ratio left a ~19mm gap under the
      // footer on every page of the mailed attachment.
      if (i > 0) pdf.addPage();
      pdf.addImage(img, "PNG", 0, 0, pw, ph);
    }

    const uri = pdf.output("datauristring");
    const content = uri.slice(uri.indexOf(",") + 1);
    return { filename: `${docName("Quotation", reference)}.pdf`, content };
  } finally {
    iframe.remove();
  }
}
