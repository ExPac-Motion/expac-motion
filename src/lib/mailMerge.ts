/** Resolves the same merge tags the Templates editor previews
 *  ({{ contact.name }}, {{ contact.company }}, {{ unsubscribe_link }})
 *  with real per-recipient values at actual send time. */
export function resolveMergeFields(
  text: string,
  ctx: { name: string; company: string; unsubscribeUrl: string },
): string {
  return text
    .replaceAll("{{ contact.name }}", ctx.name)
    .replaceAll("{{ contact.company }}", ctx.company)
    .replaceAll("{{ unsubscribe_link }}", ctx.unsubscribeUrl);
}

/** A plain-text fallback for the html body, for the email's text part. */
export function htmlToText(html: string): string {
  return html
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
