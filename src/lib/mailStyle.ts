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
 *  clients strip external stylesheets. `color` defaults to the brand green.
 *  Outlook for Windows (Word) ignores padding and border-radius on links
 *  (it showed as flat highlighted text), so it gets a VML rounded rectangle
 *  in an Outlook-only block (the usual "bulletproof button"); every other
 *  client gets the plain link. */
export function emailButtonHtml(
  href: string,
  label: string,
  color = "#719d2f",
  fixedWidth?: number,
): string {
  // VML needs a fixed width: the one asked for, else roughly the bold
  // label plus the padding.
  const width = fixedWidth ?? Math.round(label.length * 8.6 + 44);
  const mso =
    `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" ` +
    `href="${href}" style="height:40px;v-text-anchor:middle;width:${width}px" arcsize="15%" stroke="f" fillcolor="${color}">` +
    `<w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:${fixedWidth ? 14 : 15}px;font-weight:bold">${label}</center>` +
    `</v:roundrect><![endif]-->`;
  const size = fixedWidth
    ? `width:${fixedWidth}px;box-sizing:border-box;text-align:center;padding:10px 0;`
    : "padding:10px 20px;";
  const link =
    `<a href="${href}" style="display:inline-block;background:${color};` +
    `color:#fff;font-family:${EMAIL_FONT_STACK};font-size:${EMAIL_FONT_SIZE};` +
    `font-weight:700;text-decoration:none;${size}border-radius:6px;` +
    `margin:4px 12px 4px 0">${label}</a>`;
  return `${mso}<!--[if !mso]><!-- -->${link}<!--<![endif]-->`;
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
  // Outlook: every oval the same size (no halo ring there, it made the
  // current step's row taller and knocked its connector line out of line);
  // the current step still stands out by its fill, number and bold label.
  const mso =
    `<!--[if mso]><v:oval xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="true" ` +
    `style="width:${size}px;height:${size}px;v-text-anchor:middle" fillcolor="${fill}" ` +
    `strokecolor="${stroke}" strokeweight="2px">` +
    `<v:textbox inset="0,0,0,0"><center style="color:${color};font-family:Arial,sans-serif;font-size:13px;` +
    `font-weight:bold">${glyph}</center></v:textbox></v:oval><![endif]-->`;
  const circle =
    `<div style="display:inline-block;vertical-align:middle;width:${size}px;height:${size}px;border-radius:50%;` +
    `background:${fill};border:2px solid ${stroke};box-sizing:border-box;color:${color};font-family:${EMAIL_FONT_STACK};` +
    `font-size:13px;font-weight:700;line-height:${size - 4}px;text-align:center">${glyph}</div>`;
  // Only the current step has the ring; the 36px-high cell around every
  // circle keeps the lines level either way.
  const html = halo
    ? `<div style="display:inline-block;vertical-align:middle;padding:4px;border-radius:50%;background:${PROGRESS_HALO};line-height:0">${circle}</div>`
    : circle;
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
  // The first step sits flush left (in line with the text), the last flush
  // right (in line with the banner's edge), the circles evenly spaced:
  // middle cells are one gap wide, the two end cells half a gap + half a
  // circle.
  const slot = 36;
  const dot = 28; // the circle itself; the end ones sit flush in their slot
  const gap = (width - dot) / (n - 1);
  const edgePx = Math.round(gap / 2 + dot / 2);
  const midPx = Math.round(gap);
  const pct = (px: number) => `${((px / width) * 100).toFixed(2)}%`;
  const cells = PROGRESS_STEPS.map((label, i) => {
    const done = i < current;
    const now = i === current;
    // Every milestone reached (the current one too) gets a ✓; the ones
    // still to come keep their number.
    const circle = progressCircle(
      done || now ? "&#10003;" : String(i + 1),
      done || now ? PROGRESS_TEAL : "#ffffff",
      done || now ? PROGRESS_TEAL : PROGRESS_GREY,
      done || now ? "#ffffff" : PROGRESS_MUTED,
      now,
    );
    const first = i === 0;
    const last = i === n - 1;
    const align = first ? "left" : last ? "right" : "center";
    const w = first || last ? edgePx : midPx;
    return (
      `<td width="${pct(w)}" align="${align}" valign="top" style="width:${pct(w)};padding:0">` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
      (first ? "" : progressLine(i <= current ? "solid" : "dotted")) +
      `<td width="${slot}" height="${slot}" align="${align}" valign="middle" style="width:${slot}px;height:${slot}px;padding:0;text-align:${align};line-height:0">${circle}</td>` +
      (last ? "" : progressLine(i < current ? "solid" : "dotted")) +
      `</tr></table>` +
      `<a href="${href}" style="display:block;padding-top:6px;text-align:${align};text-decoration:none;font-family:${EMAIL_FONT_STACK};` +
      `font-size:12px;line-height:1.3;font-weight:${now ? 700 : 400};color:${done || now ? "#2e2e2e" : PROGRESS_MUTED}">` +
      `${label}</a></td>`
    );
  }).join("");
  // The same space above and below (to the customer's name, to Shipment
  // Status), as cell padding: Outlook ignores margins on tables.
  const space = 16;
  return (
    `<!--[if mso]><table role="presentation" width="${width}" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
    `style="width:100%;max-width:${width}px;border-collapse:collapse"><tr><td style="padding:${space}px 0">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse">` +
    `<tr>${cells}</tr></table></td></tr></table>` +
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
    PROGRESS_STEPS.map((s, i) => (i < current ? `${s} ✓` : i === current ? `${s} ✓ (now)` : s)).join(" > ")
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
