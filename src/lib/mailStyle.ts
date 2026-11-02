/**
 * Default typography for everything the app emails out, one-off customer
 * mail, campaigns, follow-ups, shipment notifications, and for the signature
 * editor, so what you type matches what the recipient sees.
 *
 * Aptos is Microsoft's current default sans (the Calibri successor). Mail
 * clients that don't ship it fall through Calibri → Segoe UI → a plain system
 * sans; unknown families are simply skipped, so the stack is safe everywhere.
 *
 * The Cloudflare function `functions/api/send-mail.ts` keeps its own copy of
 * these values (it's built separately and can't import this module), keep the
 * two in sync.
 */
export const EMAIL_FONT_STACK =
  "Aptos, 'Aptos Display', Calibri, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Normal writing size for email bodies. Points, to match Word / Outlook
 *  (Aptos 11pt is the Office default), email clients honour pt in inline
 *  styles. Roughly 14.7px. */
export const EMAIL_FONT_SIZE = "11pt";

/** Inline style string for an email body wrapper. */
export const EMAIL_BODY_STYLE =
  `font-family:${EMAIL_FONT_STACK};font-size:${EMAIL_FONT_SIZE};` +
  `line-height:1.55;color:#2e2e2e`;

/** A branded CTA button for outgoing mail, inline-styled since most mail
 *  clients strip external stylesheets. `color` defaults to the brand green. */
export function emailButtonHtml(
  href: string,
  label: string,
  color = "#719d2f",
): string {
  return (
    `<a href="${href}" style="display:inline-block;background:${color};` +
    `color:#fff;font-family:${EMAIL_FONT_STACK};font-size:${EMAIL_FONT_SIZE};` +
    `font-weight:700;text-decoration:none;padding:10px 20px;border-radius:6px;` +
    `margin:4px 12px 4px 0">${label}</a>`
  );
}

/** The six milestones the customer sees on the shipment progress bar. */
export const PROGRESS_STEPS = ["Created", "Booked", "Collected", "Shipped", "In Transit", "Delivered"] as const;

const PROGRESS_TEAL = "#02858a"; // brand teal, darkened for white-on-teal contrast
const PROGRESS_HALO = "#cceced";
const PROGRESS_GREY = "#c7c7c2";
const PROGRESS_MUTED = "#8a8a85";

/** One milestone circle. Outlook for Windows (Word) ignores border-radius,
 *  so it gets a VML oval in an Outlook-only block; every other client gets
 *  a rounded div. `halo`: the current step's light ring. */
function progressCircle(glyph: string, fill: string, stroke: string, color: string, halo: boolean): string {
  const size = 28;
  const outer = halo ? size + 8 : size;
  const mso =
    `<!--[if mso]><v:oval xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="true" ` +
    `style="width:${outer}px;height:${outer}px;v-text-anchor:middle" fillcolor="${fill}" ` +
    `strokecolor="${halo ? PROGRESS_HALO : stroke}" strokeweight="${halo ? 4 : 2}px">` +
    `<v:textbox inset="0,0,0,0"><center style="color:${color};font-family:Arial,sans-serif;font-size:13px;` +
    `font-weight:bold">${glyph}</center></v:textbox></v:oval><![endif]-->`;
  const circle =
    `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${fill};border:2px solid ${stroke};` +
    `box-sizing:border-box;color:${color};font-family:${EMAIL_FONT_STACK};font-size:13px;font-weight:700;` +
    `line-height:${size - 4}px;text-align:center">${glyph}</div>`;
  // Every circle sits in the same 36px ring (halo colour or transparent),
  // so the lines and labels line up across the steps.
  const html = `<div style="width:${size}px;padding:4px;border-radius:50%;background:${halo ? PROGRESS_HALO : "transparent"};margin:0 auto">${circle}</div>`;
  return `${mso}<!--[if !mso]><!-- -->${html}<!--<![endif]-->`;
}

/** A connector between circles: a solid teal bar (done) or a dotted grey
 *  one (to come), as a 3px table cell, which Outlook draws reliably. */
function progressLine(kind: "solid" | "dotted" | "none"): string {
  if (kind === "none") return `<td style="padding:0"></td>`;
  const look =
    kind === "solid"
      ? `bgcolor="${PROGRESS_TEAL}" style="height:3px;background:${PROGRESS_TEAL};`
      : `style="height:0;border-top:3px dotted ${PROGRESS_GREY};`;
  return (
    `<td valign="middle" style="padding:0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
    `<tr><td ${look}font-size:1px;line-height:1px;mso-line-height-rule:exactly">&nbsp;</td></tr></table></td>`
  );
}

/**
 * The shipment progress bar, the top banner of customer status mail:
 * `current` is the index of the step it's at (PROGRESS_STEPS.length = all
 * done, delivered). Done steps are teal circles with a ✓ joined by a
 * solid line, the current one has a light halo, the rest are white
 * circles with a grey number joined by a dotted line. No background.
 * `width` is the signature banner's width (signatureBannerWidth), so the
 * two line up; Outlook ignores max-width, hence its fixed-width wrapper.
 *
 * Deliverability: tables + inline styles, plus Outlook-only VML circles
 * (the standard way to draw round shapes for Outlook); no images, SVG, web
 * fonts or scripts. The labels link to the Live Tracking page.
 */
export function emailProgressHtml(current: number, href: string, width = 600): string {
  const n = PROGRESS_STEPS.length;
  const cells = PROGRESS_STEPS.map((label, i) => {
    const done = i < current;
    const now = i === current;
    const circle = progressCircle(
      done ? "&#10003;" : String(i + 1),
      done || now ? PROGRESS_TEAL : "#ffffff",
      done || now ? PROGRESS_TEAL : PROGRESS_GREY,
      done || now ? "#ffffff" : PROGRESS_MUTED,
      now,
    );
    return (
      `<td width="16.66%" align="center" valign="top" style="width:16.66%;padding:0">` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
      progressLine(i === 0 ? "none" : i <= current ? "solid" : "dotted") +
      `<td width="36" height="36" align="center" valign="middle" style="width:36px;height:36px;padding:0">${circle}</td>` +
      progressLine(i === n - 1 ? "none" : i < current ? "solid" : "dotted") +
      `</tr></table>` +
      `<a href="${href}" style="display:block;padding-top:6px;text-decoration:none;font-family:${EMAIL_FONT_STACK};` +
      `font-size:12px;line-height:1.3;font-weight:${now ? 700 : 400};color:${done || now ? "#2e2e2e" : PROGRESS_MUTED}">` +
      `${label}</a></td>`
    );
  }).join("");
  return (
    `<!--[if mso]><table role="presentation" width="${width}" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
    `style="width:100%;max-width:${width}px;border-collapse:collapse;margin:0 0 16px"><tr>${cells}</tr></table>` +
    `<!--[if mso]></td></tr></table><![endif]-->`
  );
}

/** The signature banner's width in px: the widest image (or fixed-width
 *  table) in the saved signature, by its width attribute or inline width,
 *  so the progress bar lines up with it. 600 when there's none. */
export function signatureBannerWidth(signatureHtml?: string | null): number {
  const html = signatureHtml ?? "";
  const widths: number[] = [];
  for (const tag of html.match(/<(img|table)\b[^>]*>/gi) ?? []) {
    const attr = tag.match(/\swidth\s*=\s*["']?(\d+)(?:px)?["']?/i);
    const css = tag.match(/style\s*=\s*["'][^"']*?(?:^|[;\s])(?:max-)?width\s*:\s*(\d+)px/i);
    for (const m of [attr, css]) if (m) widths.push(Number(m[1]));
  }
  const fit = widths.filter((w) => w >= 300 && w <= 900);
  return fit.length ? Math.max(...fit) : 600;
}

/** Plain-text twin of emailProgressHtml, for the mail's text part. */
export function emailProgressText(current: number): string {
  return (
    "Progress: " +
    PROGRESS_STEPS.map((s, i) => (i < current ? `${s} ✓` : i === current ? `${s} (now)` : s)).join(" > ")
  );
}

/** Mobile mail clients, Gmail's app especially, aggressively auto-link
 *  bare phone numbers, emails and URLs in plain text with their own loud
 *  blue-underline styling. Giving them a real link ourselves, styled to
 *  blend into the surrounding text, heads that off (clients don't
 *  re-process text already inside an <a>). `!important` because some
 *  clients (Outlook, older Gmail) force their own link color otherwise. */
export const MAIL_LINK_STYLE =
  "color:inherit!important;text-decoration:none!important";

/** Merge MAIL_LINK_STYLE into an existing <a ...>...</a> block's style
 *  attribute (or add one) without touching its href or content, for a
 *  link the author already hand-created (e.g. via the rich-text editor's
 *  "Add link" button) that has no color/underline override of its own, so
 *  it would otherwise render with the mail client's default blue
 *  underline. */
function restyleAnchor(anchorHtml: string): string {
  if (/\sstyle\s*=\s*"/i.test(anchorHtml)) {
    return anchorHtml.replace(
      /(\sstyle\s*=\s*")/i,
      `$1${MAIL_LINK_STYLE};`,
    );
  }
  return anchorHtml.replace(/^<a\b/i, `<a style="${MAIL_LINK_STYLE}"`);
}

/** Restyle any explicit <a>...</a> (one added with the rich-text editor's
 *  "Add link" button, a merge-resolved unsubscribe link) to blend in -- see
 *  MAIL_LINK_STYLE. Bare phone numbers, emails and www. addresses are left
 *  as plain text: no auto-made hyperlinks in outgoing mail. */
export function linkifyHtml(html: string): string {
  return html
    .split(/(<a\b[^>]*>[\s\S]*?<\/a>)/gi)
    .map((part, i) => {
      if (i % 2 === 1) return restyleAnchor(part);
      return part;
    })
    .join("");
}

/**
 * Public origin for every link placed in outgoing mail (Live Tracking,
 * unsubscribe). Always the app's own branded domain, never
 * window.location.origin, which is expac-motion.pages.dev when the team
 * works there: links to the shared pages.dev hosting domain (widely abused
 * for phishing) push mail into spam. Override with VITE_PUBLIC_APP_URL.
 */
export const PUBLIC_APP_URL = (
  (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined) ||
  "https://expac-motion.co.za"
).replace(/\/+$/, "");
