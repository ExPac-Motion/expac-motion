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

/**
 * The shipment progress bar for customer mail: `current` is the index of
 * the step it's at (PROGRESS_STEPS.length = all done, delivered). Done
 * steps are teal with a ✓ joined by a solid line, the current one has a
 * light halo, the rest are grey numbers joined by a dotted line.
 *
 * Deliverability: tables + inline styles only, like emailButtonHtml; no
 * images, SVG, web fonts or scripts. Older Outlook desktop squares the
 * circles off (no border-radius), nothing else changes. The whole bar
 * links to `href` (the Live Tracking page, already in the mail).
 */
export function emailProgressHtml(current: number, href: string): string {
  const n = PROGRESS_STEPS.length;
  const cells = PROGRESS_STEPS.map((label, i) => {
    const done = i < current;
    const now = i === current;
    const line = (on: boolean, show: boolean) =>
      show
        ? `<td style="padding:0;vertical-align:middle"><div style="height:0;border-top:3px ${on ? `solid ${PROGRESS_TEAL}` : `dotted ${PROGRESS_GREY}`};font-size:0;line-height:0">&nbsp;</div></td>`
        : `<td style="padding:0"></td>`;
    const fill = done || now ? PROGRESS_TEAL : "#ffffff";
    // Fixed 40px cell (circle + halo) so the lines can't squeeze the circle.
    const circle =
      `<td width="40" style="width:40px;min-width:40px;padding:0">` +
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>` +
      `<td style="padding:4px;border-radius:50%;background:${now ? PROGRESS_HALO : "transparent"}">` +
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
      `<td align="center" valign="middle" width="26" height="26" style="width:26px;height:26px;min-width:26px;` +
      `border-radius:50%;background:${fill};border:2px solid ${done || now ? PROGRESS_TEAL : PROGRESS_GREY};` +
      `color:${done || now ? "#ffffff" : PROGRESS_MUTED};font-family:${EMAIL_FONT_STACK};font-size:13px;` +
      `font-weight:700;line-height:26px;text-align:center;mso-line-height-rule:exactly">` +
      `${done ? "&#10003;" : i + 1}</td></tr></table></td></tr></table></td>`;
    return (
      `<td width="16.66%" align="center" valign="top" style="width:16.66%;padding:0">` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
      `${line(i <= current, i > 0)}${circle}${line(i < current, i < n - 1)}</tr></table>` +
      `<div style="padding-top:6px;font-family:${EMAIL_FONT_STACK};font-size:12px;line-height:1.3;` +
      `font-weight:${now ? 700 : 400};color:${done || now ? "#2e2e2e" : PROGRESS_MUTED}">${label}</div></td>`
    );
  }).join("");
  return (
    `<a href="${href}" style="text-decoration:none;display:block">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
    `style="width:100%;max-width:640px;border-collapse:collapse;margin:12px 0 10px"><tr>${cells}</tr></table></a>`
  );
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
