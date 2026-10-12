import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** True when both env vars are present, so the UI can show a helpful setup screen otherwise. */
export const isSupabaseConfigured = Boolean(url && anonKey);

if (!isSupabaseConfigured) {
  // eslint-disable-next-line no-console
  console.warn(
    "Supabase is not configured. Copy .env.example to .env.local and fill in " +
      "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see SETUP.md).",
  );
}

export const supabase = createClient(
  url || "https://placeholder.supabase.co",
  anonKey || "placeholder-anon-key",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);

/** A Supabase signed storage URL as a link on ExPac's own site
 *  (`/doc/...`, functions/doc), so the database host never shows. Dev
 *  (no Pages functions) keeps the original URL. */
export function brandStorageUrl(signedUrl: string): string {
  if (import.meta.env.DEV || !url || typeof window === "undefined") return signedUrl;
  const prefix = url.replace(/\/+$/, "") + "/storage/v1/object/sign/";
  return signedUrl.startsWith(prefix) ? `${window.location.origin}/doc/${signedUrl.slice(prefix.length)}` : signedUrl;
}

/** A public `mail-assets` URL (logo, Media / announcement images) on
 *  ExPac's own site: the CDN when VITE_MAIL_CDN_BASE is set, else this
 *  site's /mail-assets proxy (functions/mail-assets). Dev keeps it as is. */
export function brandPublicUrl(publicUrl: string): string {
  const marker = "/storage/v1/object/public/mail-assets/";
  const i = publicUrl.indexOf(marker);
  if (i === -1 || import.meta.env.DEV || typeof window === "undefined") return publicUrl;
  const cdn = ((import.meta.env.VITE_MAIL_CDN_BASE as string | undefined) ?? "").replace(/\/+$/, "");
  return `${cdn || window.location.origin + "/mail-assets"}/${publicUrl.slice(i + marker.length)}`;
}

/** The ExPac logo on the sign-in / sign-up / pending pages. */
export const BRAND_LOGO_URL = brandPublicUrl(
  "https://fdzwnvinqiqrexhzgqkp.supabase.co/storage/v1/object/public/mail-assets/media/d2dbb470-55b1-483c-92ff-0cba3a2756b5.png",
);
