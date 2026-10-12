/**
 * Cloudflare Pages Function, document links on ExPac's own domain.
 *
 * WHY: opening a shipment document used a Supabase signed URL
 * (`https://<project>.supabase.co/storage/v1/object/sign/...?token=...`),
 * which shows the database host to customers and staff. The app now hands
 * out `https://<this site>/doc/<bucket>/<path>?token=...` instead
 * (src/lib/supabase.ts `brandStorageUrl`) and this function passes it
 * through to the same signed URL.
 *
 * Security is unchanged: the short-lived signed token is still what grants
 * access, Supabase checks it; without a valid token this returns its error.
 * Only the private shipment-documents bucket is served.
 *
 * Reads SUPABASE_URL (already set for the other functions).
 *
 * Not part of the Vite build or `tsc` project; Cloudflare builds functions/.
 */

const BUCKETS = ["shipment-documents"];

export async function onRequestGet({ request, env }) {
  const base = env && env.SUPABASE_URL;
  if (!base) return new Response("SUPABASE_URL is not configured on this deployment.", { status: 500 });

  const url = new URL(request.url);
  // Keep the path exactly as encoded in the signed URL.
  const rest = url.pathname.replace(/^\/doc\//, "");
  const bucket = decodeURIComponent(rest.split("/")[0] || "");
  if (!BUCKETS.includes(bucket) || rest.includes("..") || !url.searchParams.get("token")) {
    return new Response("Not found", { status: 404 });
  }

  let res;
  try {
    res = await fetch(`${base.replace(/\/+$/, "")}/storage/v1/object/sign/${rest}${url.search}`);
  } catch (e) {
    return new Response("Could not reach storage: " + (e && e.message ? e.message : e), { status: 502 });
  }
  if (!res.ok) {
    return new Response(res.status === 400 || res.status === 403 ? "This link has expired, open the document again from ExPac Motion." : "Document not found", {
      status: res.status,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const headers = new Headers();
  for (const h of ["content-type", "content-length", "content-disposition", "last-modified", "etag"]) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  headers.set("cache-control", "private, no-store");
  headers.set("x-robots-tag", "noindex");
  return new Response(res.body, { status: 200, headers });
}
