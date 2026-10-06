/**
 * Cloudflare Pages Function, runs on every request to every domain this
 * deployment answers to (expac-motion.co.za, expac-motion.pages.dev, any
 * preview-deployment alias).
 *
 * expac-motion.pages.dev stays fully live deliberately (the team keeps
 * working there day-to-day, see project memory), but only
 * expac-motion.co.za should ever show up in search results. A static
 * robots.txt/meta tag can't tell these domains apart since they're the
 * exact same build; this middleware can, because it sees the actual
 * Host header on each request.
 *
 * X-Robots-Tag is the authoritative "don't index this" signal to Google,
 * stronger than robots.txt, which only blocks crawling (a page can still
 * get indexed from an inbound link without ever being crawled). It's set
 * PRODUCTION_HOST allowlist-style (indexable only if the Host matches
 * exactly) so any current or future alternate domain defaults to blocked.
 *
 * This also injects Open Graph / Twitter Card tags into hosted web-form
 * pages (/forms/:id) only, those are the one route type meant to be
 * shared directly (WhatsApp, email, etc.). The app is a client-rendered
 * SPA with one static index.html for every route, and link-preview
 * crawlers don't execute JS, so this can't be done from React at all;
 * without it, a platform falling back to guessing a preview image from
 * the bare favicon (a small square icon, never meant for a wide
 * share-card crop) is what produced the oversized/off-centre logo seen
 * on a shared form link. public/og-form-share.png is a purpose-built
 * 1200x630 card (the full logo lockup, centred, with real margin).
 */

const PRODUCTION_HOST = "expac-motion.co.za";

class HeadAppender {
  constructor(private html: string) {}
  element(element: Element) {
    element.append(this.html, { html: true });
  }
}

export async function onRequest(context) {
  let response = await context.next();
  const url = new URL(context.request.url);
  const host = url.hostname;

  if (host !== PRODUCTION_HOST) {
    const headers = new Headers(response.headers);
    headers.set("X-Robots-Tag", "noindex, nofollow");
    response = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  if (
    url.pathname.startsWith("/forms/") &&
    (response.headers.get("content-type") || "").includes("text/html")
  ) {
    const ogImage = `${url.origin}/og-form-share.png`;
    const tags = `
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="ExPac Motion">
    <meta property="og:title" content="ExPac Motion">
    <meta property="og:description" content="Fill out this form to get started.">
    <meta property="og:image" content="${ogImage}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:image" content="${ogImage}">`;
    response = new HTMLRewriter()
      .on("head", new HeadAppender(tags))
      .transform(response);
  }

  return response;
}
