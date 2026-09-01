/**
 * Whether every user must enrol in two-factor.
 *
 * Enforcement cannot happen at the login gate: a user with no enrolment yet
 * would be locked out of the very page where they would set it up. Instead the
 * session is issued as normal and the authed layout redirects them to
 * /security until they finish.
 */
export function twoFactorRequired(): boolean {
  const v = (process.env.SOCMED_REQUIRE_2FA ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}
