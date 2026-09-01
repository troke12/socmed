import type { Role } from "@/lib/auth/roles";

/**
 * Whether editors have to get a post approved before it can go out.
 *
 * Off by default so existing single-operator and editor-trusted installs keep
 * behaving exactly as they did. Turning it on only constrains editors — an
 * admin publishing their own post is the approver.
 */
export function approvalRequired(): boolean {
  const v = (process.env.SOCMED_REQUIRE_APPROVAL ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** True when this role must route a post through review before it can publish. */
export function needsApproval(role: Role): boolean {
  return approvalRequired() && role !== "admin";
}
