// Bluesky session lifecycle.
//
// Bluesky auth is handle + app password, but the app password is NOT a bearer
// token: every XRPC call needs a real `accessJwt` minted by
// com.atproto.server.createSession. The accessJwt is short-lived (~2h), so we
// keep the app password in `raw.appPassword` and re-mint on demand — the user
// only ever enters the app password once, on the Accounts page.
//
// Creds layout we converge on (EncryptedCreds):
//   accessToken  = accessJwt
//   refreshToken = refreshJwt
//   expiresAt    = accessJwt `exp` (unix seconds)
//   raw.appPassword = the app password the user pasted
//   raw.did / raw.handle / raw.pdsUrl = resolved identity, cached
//
// On the very first use, creds are whatever the Accounts POST stored:
// `{ accessToken: <app password> }` with no `raw`. We detect that by the
// absence of raw.did and treat accessToken as the app password.

import type { AccountWithCreds, EncryptedCreds } from "../types";
import { saveAccountCreds } from "../creds";
import {
  blueskyCreateSession,
  blueskyPdsFromDidDoc,
  blueskyRefreshSession,
  blueskyResolveIdentity,
} from "./client";

export interface BlueskyLiveSession {
  pdsUrl: string;
  did: string;
  accessJwt: string;
}

interface BlueskyRaw {
  did?: string;
  handle?: string;
  pdsUrl?: string;
  appPassword?: string;
}

// Renew a little early so a job that starts just under the wire doesn't get a
// 401 mid-publish.
const EXPIRY_SKEW_SEC = 120;
// Fallback lifetime when the accessJwt has no readable `exp` claim.
const FALLBACK_TTL_SEC = 90 * 60;

/** Read the `exp` claim out of a JWT without verifying it (we're not the audience). */
function jwtExp(jwt: string): number | undefined {
  const payload = jwt.split(".")[1];
  if (!payload) return undefined;
  try {
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown };
    return typeof json.exp === "number" ? json.exp : undefined;
  } catch {
    return undefined;
  }
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Return a usable `{ pdsUrl, did, accessJwt }` for the account, minting or
 * refreshing the session as needed and persisting the result.
 *
 * Order of preference: live accessJwt -> refreshSession -> createSession with
 * the stored app password. createSession is always reachable as long as the app
 * password is still valid, so a stale/rotated refreshJwt is not fatal.
 */
export async function blueskyEnsureSession(account: AccountWithCreds): Promise<BlueskyLiveSession> {
  const creds = (account._creds ?? {}) as EncryptedCreds & Record<string, unknown>;
  const raw = ((creds.raw as BlueskyRaw | undefined) ?? {}) as BlueskyRaw;

  // Before the first createSession, accessToken IS the app password.
  const appPassword = raw.appPassword ?? (raw.did ? undefined : creds.accessToken);
  const handle = (raw.handle ?? account.handle ?? "").trim();
  const identifier = handle || raw.did;
  if (!identifier) {
    throw new Error("Bluesky: account has no handle or DID — re-add the account");
  }

  // An operator-set BLUESKY_PDS_URL is an explicit override; otherwise use the
  // cached endpoint, and only resolve identity when we have neither.
  let pdsUrl = raw.pdsUrl ?? process.env.BLUESKY_PDS_URL;
  let did = raw.did;
  if (!pdsUrl || !did) {
    const resolved = await blueskyResolveIdentity(identifier);
    did = did ?? resolved.did;
    pdsUrl = pdsUrl ?? resolved.pdsUrl;
  }

  // Fast path: existing accessJwt still valid.
  if (raw.did && creds.accessToken && (creds.expiresAt ?? 0) > nowSec() + EXPIRY_SKEW_SEC) {
    return { pdsUrl, did, accessJwt: creds.accessToken };
  }

  let session: Awaited<ReturnType<typeof blueskyCreateSession>> | undefined;
  if (creds.refreshToken && raw.did) {
    try {
      session = await blueskyRefreshSession(creds.refreshToken, pdsUrl);
    } catch {
      // refreshJwt expired or rotated out — fall back to a fresh createSession.
      session = undefined;
    }
  }
  if (!session) {
    if (!appPassword) {
      throw new Error("Bluesky: session expired and no app password stored — re-add the account");
    }
    session = await blueskyCreateSession(identifier, appPassword, pdsUrl);
  }

  // createSession/refreshSession embed the DID document when they resolved the
  // account by handle; trust it over our cached endpoint.
  const fromDoc = blueskyPdsFromDidDoc(session.didDoc);
  if (fromDoc) pdsUrl = fromDoc;

  if (session.active === false) {
    throw new Error(`Bluesky: account not active${session.status ? ` (${session.status})` : ""}`);
  }

  const next: EncryptedCreds = {
    accessToken: session.accessJwt,
    refreshToken: session.refreshJwt,
    expiresAt: jwtExp(session.accessJwt) ?? nowSec() + FALLBACK_TTL_SEC,
    raw: {
      ...(creds.raw as Record<string, unknown> | undefined),
      did: session.did,
      handle: session.handle,
      pdsUrl,
      ...(appPassword ? { appPassword } : {}),
    },
  };
  if (account.id) {
    saveAccountCreds(account.id, next);
    // Keep the in-memory creds in step so later calls in the same job reuse it.
    account._creds = next as unknown as Record<string, unknown>;
  }

  return { pdsUrl, did: session.did, accessJwt: session.accessJwt };
}
