import { atLeast, type Role } from "./roles";
import { requireSession, type AuthedUser } from "./require";
import { authenticateApiToken, type ApiActor } from "./api-token";

export type Actor =
  | (AuthedUser & { kind: "user" })
  | ApiActor;

function forbidden(message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = 403;
  return err;
}

/**
 * Authenticates a request by bearer token or session cookie, then enforces a
 * minimum role.
 *
 * Bearer is tried first so an automation calling from a browser that also holds
 * a session cookie gets the token's role, not the logged-in user's — otherwise
 * a token deliberately scoped to viewer could act as an admin.
 *
 * API tokens cannot exceed editor (enforced at issue time by the schema, and
 * again here). User and account management stays cookie-only: those handle
 * credentials and other people's access, and a long-lived static token is the
 * wrong instrument for them.
 */
export async function requireActor(req: Request, minRole: Role): Promise<Actor> {
  const token = authenticateApiToken(req);
  if (token) {
    if (!atLeast(token.role, minRole)) {
      throw forbidden(`this token has ${token.role} access; ${minRole} is required`);
    }
    return token;
  }

  const user = await requireSession();
  if (!atLeast(user.role, minRole)) {
    throw forbidden(`requires ${minRole} role or higher`);
  }
  return { ...user, kind: "user" };
}

/** The users.id to attribute a write to, or null for a token-driven one. */
export function actorUserId(actor: Actor): number | null {
  return actor.kind === "user" ? actor.id : null;
}

export function actorLabel(actor: Actor): string {
  return actor.kind === "user" ? actor.username : `token:${actor.name}`;
}
