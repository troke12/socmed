import type { Role } from "@db/schema";

export type { Role };

// Ordered least to most privileged; the index is the comparison key.
const ORDER: Role[] = ["viewer", "editor", "admin"];

export function rank(role: Role): number {
  return ORDER.indexOf(role);
}

export function atLeast(role: Role, min: Role): boolean {
  return rank(role) >= rank(min);
}

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: "Full access, including connecting accounts and managing users.",
  editor: "Can compose, schedule, publish and reply. Cannot manage accounts or users.",
  viewer: "Read-only access to posts, calendar, analytics and inbox.",
};
