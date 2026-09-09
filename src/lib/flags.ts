/**
 * Simple compile-time feature flags. Flip a value and redeploy — no env var
 * or dashboard needed. Keep the list short; delete a flag once its feature
 * has fully shipped.
 */

/**
 * Customer Portal sign-up. While `false`, the /portal/signup page shows a
 * "not yet available" notice instead of the account form, and staff don't
 * see the "Invite to Portal" button on a customer. Set to `true` when the
 * portal is ready for customers.
 */
export const PORTAL_SIGNUP_ENABLED = false;

/**
 * The account that sees the "Personal Vault" tab under Control Tower. The
 * vault's data is RLS-locked to each user anyway; this just decides whose
 * nav shows the tab. Change to your own login email.
 */
export const VAULT_OWNER_EMAIL = "support@expac.co.za";

export function isVaultOwner(email: string | null | undefined): boolean {
  return (
    !!email && email.trim().toLowerCase() === VAULT_OWNER_EMAIL.toLowerCase()
  );
}
