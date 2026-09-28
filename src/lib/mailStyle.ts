/**
 * Default typography for everything the app emails out — one-off customer
 * mail, campaigns, follow-ups, shipment notifications — and for the signature
 * editor, so what you type matches what the recipient sees.
 *
 * Aptos is Microsoft's current default sans (the Calibri successor). Mail
 * clients that don't ship it fall through Calibri → Segoe UI → a plain system
 * sans; unknown families are simply skipped, so the stack is safe everywhere.
 *
 * The Cloudflare function `functions/api/send-mail.ts` keeps its own copy of
 * these values (it's built separately and can't import this module) — keep the
 * two in sync.
 */
export const EMAIL_FONT_STACK =
  "Aptos, 'Aptos Display', Calibri, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Normal writing size for email bodies. Points, to match Word / Outlook
 *  (Aptos 11pt is the Office default) — email clients honour pt in inline
 *  styles. Roughly 14.7px. */
export const EMAIL_FONT_SIZE = "11pt";

/** Inline style string for an email body wrapper. */
export const EMAIL_BODY_STYLE =
  `font-family:${EMAIL_FONT_STACK};font-size:${EMAIL_FONT_SIZE};` +
  `line-height:1.55;color:#2e2e2e`;

/** A branded CTA button for outgoing mail — inline-styled since most mail
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

/** Mobile mail clients — Gmail's app especially — aggressively auto-link
 *  bare phone numbers, emails and URLs in plain text with their own loud
 *  blue-underline styling. Giving them a real link ourselves, styled to
 *  blend into the surrounding text, heads that off (clients don't
 *  re-process text already inside an <a>). `!important` because some
 *  clients (Outlook, older Gmail) force their own link color otherwise. */
export const MAIL_LINK_STYLE =
  "color:inherit!important;text-decoration:none!important";

/** "+27 (0) 11 568 8281" -> "+27115688281" — the (0) is a "drop this for
 *  international dialing" trunk-prefix marker, not itself a digit to dial. */
function phoneDigits(value: string): string {
  return value.replace(/\(0\)/g, "").replace(/[^\d+]/g, "");
}

/** Merge MAIL_LINK_STYLE into an existing <a ...>...</a> block's style
 *  attribute (or add one) without touching its href or content — for a
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

/** Turn bare phone numbers, email addresses and www. URLs in raw HTML
 *  (e.g. a hand-typed signature, a campaign body) into real links styled
 *  to blend in — see MAIL_LINK_STYLE. An existing <a>...</a> (e.g. one
 *  hand-created via the rich-text editor's "Add link" button, or a
 *  merge-resolved unsubscribe link) is left alone but restyled the same
 *  way if it has no color of its own, rather than re-processing its
 *  content — so this is safe to run on HTML that's already part-linked. */
export function linkifyHtml(html: string): string {
  return html
    .split(/(<a\b[^>]*>[\s\S]*?<\/a>)/gi)
    .map((part, i) => {
      if (i % 2 === 1) return restyleAnchor(part);
      return part
        .replace(
          /[\w.+-]+@[\w-]+\.[\w.-]+/g,
          (email) => `<a href="mailto:${email}" style="${MAIL_LINK_STYLE}">${email}</a>`,
        )
        .replace(
          /\+\d[\d\s()]{6,}\d/g,
          (phone) =>
            `<a href="tel:${phoneDigits(phone)}" style="${MAIL_LINK_STYLE}">${phone}</a>`,
        )
        .replace(
          /\bwww\.[\w-]+\.[a-z]{2,}\b/gi,
          (url) => `<a href="https://${url}" style="${MAIL_LINK_STYLE}">${url}</a>`,
        );
    })
    .join("");
}
