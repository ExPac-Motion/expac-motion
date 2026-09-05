/**
 * Cloudflare Pages Function — CDN proxy for the Supabase public
 * `mail-assets` storage bucket.
 *
 * WHY: campaign / template emails embed inline images. Served straight from
 * `https://<project>.supabase.co/storage/v1/object/public/mail-assets/…`,
 * a generic cloud-storage host that doesn't align with the sending domain
 * `send.expac.co.za`, Outlook/SmartScreen treats them as a phishing signal
 * and junks the mail. Fronting the same files on `cdn.expac.co.za` (an
 * expac.co.za subdomain added as a second custom domain on this same Pages
 * project) removes that misalignment.
 *
 * Route: this file matches `/mail-assets/<path>` on every domain bound to
 * the Pages project. Point `cdn.expac.co.za` at the project and image URLs
 * become `https://cdn.expac.co.za/mail-assets/<uuid>.png`. The client
 * (src/lib/db.ts `publicMailAssetUrl`) builds those URLs from
 * `VITE_MAIL_CDN_BASE`; leave that unset and nothing here is exercised.
 *
 * Reads `SUPABASE_URL` — already configured in the Pages env for the other
 * functions — so there is no project ref to hard-code here.
 *
 * GET only; the bucket is public so no auth. Long, immutable cache: the
 * app only ever uploads new objects under fresh UUID names.
 *
 * Not part of the Vite build or `tsc` project (tsconfig includes only
 * `src`); Cloudflare Pages builds `functions/` on its own.
 */

export async function onRequestGet(context) {
  const base = context.env && context.env.SUPABASE_URL;
  if (!base) {
    return new Response("SUPABASE_URL is not configured on this deployment.", {
      status: 500,
    });
  }

  const parts = context.params && context.params.path;
  const rel = Array.isArray(parts) ? parts.join("/") : String(parts || "");
  if (!rel || rel.includes("..")) {
    return new Response("Not found", { status: 404 });
  }

  const upstream =
    base.replace(/\/+$/, "") +
    "/storage/v1/object/public/mail-assets/" +
    rel.split("/").map(encodeURIComponent).join("/");

  let res;
  try {
    res = await fetch(upstream, {
      cf: { cacheEverything: true, cacheTtl: 86400 },
    });
  } catch (e) {
    return new Response(
      "Could not reach storage: " + (e && e.message ? e.message : e),
      { status: 502 },
    );
  }

  const headers = new Headers();
  const passthrough = ["content-type", "content-length", "etag", "last-modified"];
  for (const h of passthrough) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  headers.set(
    "cache-control",
    res.ok
      ? "public, max-age=86400, s-maxage=604800, immutable"
      : "no-store",
  );
  headers.set("access-control-allow-origin", "*");

  return new Response(res.body, { status: res.status, headers });
}
