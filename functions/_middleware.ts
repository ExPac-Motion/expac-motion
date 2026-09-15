/**
 * Cloudflare Pages Function — runs on every request to every domain this
 * deployment answers to (expac-motion.co.za, expac-motion.pages.dev, any
 * preview-deployment alias).
 *
 * expac-motion.pages.dev stays fully live deliberately (the team keeps
 * working there day-to-day — see project memory), but only
 * expac-motion.co.za should ever show up in search results. A static
 * robots.txt/meta tag can't tell these domains apart since they're the
 * exact same build; this middleware can, because it sees the actual
 * Host header on each request.
 *
 * X-Robots-Tag is the authoritative "don't index this" signal to Google —
 * stronger than robots.txt, which only blocks crawling (a page can still
 * get indexed from an inbound link without ever being crawled). It's set
 * PRODUCTION_HOST allowlist-style (indexable only if the Host matches
 * exactly) so any current or future alternate domain defaults to blocked.
 */

const PRODUCTION_HOST = "expac-motion.co.za";

export async function onRequest(context) {
  const response = await context.next();
  const host = new URL(context.request.url).hostname;

  if (host === PRODUCTION_HOST) return response;

  const headers = new Headers(response.headers);
  headers.set("X-Robots-Tag", "noindex, nofollow");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
