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
