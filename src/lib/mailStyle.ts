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
