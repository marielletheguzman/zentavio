/**
 * OIDC token verification (ADR-0017).
 *
 * **Provider-agnostic on purpose.** The issuer, audience, and JWKS endpoint are configuration, so
 * Clerk, WorkOS, Auth0, or a self-hosted Keycloak are three environment variables rather than a code
 * change. That is the substance of choosing OIDC over a vendor SDK.
 *
 * **This module verifies a token and nothing else.** It does not read a database and does not know
 * what a `users` row is — `ai/`-style statelessness applied to identity. Mapping a verified subject
 * to a local user is the gateway's job, which keeps `packages/auth` free of storage and keeps the
 * verification testable with locally generated keys and no network.
 *
 * Every check here exists because skipping it is a known, exploited mistake:
 *
 * - **signature** — the obvious one, and the reason `jose` is a dependency rather than hand-rolled
 * - **`alg`** — a token claiming `none`, or claiming HMAC against a public key, is the classic
 *   algorithm-confusion attack. `jose` is pinned to the asymmetric algorithms the JWKS advertises.
 * - **issuer** — without it, a token from *any* provider with a valid signature is accepted
 * - **audience** — without it, a token minted for a different application of the same provider works
 *   here. This is the check most often left out.
 * - **expiry** — with a small clock skew allowance, because a strict comparison across two machines
 *   rejects valid tokens for no reason
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

export interface OidcConfig {
  /** Exactly as the provider states it. Compared literally against the `iss` claim. */
  readonly issuer: string;
  /** This application's client id. A token minted for another audience is refused. */
  readonly audience: string;
  /**
   * Where the signing keys live. Defaults to the conventional discovery path, which every
   * mainstream provider serves.
   */
  readonly jwksUri?: string;
  /** Tolerance for clock drift between this machine and the provider. */
  readonly clockToleranceSeconds?: number;
}

/** A verified external identity. Not yet a Zentavio user — that mapping is the gateway's. */
export interface VerifiedIdentity {
  /** The provider's stable identifier for the person. Maps to `users.auth_subject`. */
  readonly subject: string;
  /** `oidc:<issuer>`, matching `users.auth_provider`. */
  readonly provider: string;
  /** Present when the provider asserts it, and only when it says the address is verified. */
  readonly email?: string;
}

export class TokenVerificationError extends Error {
  constructor() {
    // Fixed message. Telling a caller whether a token was expired, forged, or for the wrong
    // audience is a probing oracle, and the distinction is useless to a legitimate client.
    super('Token verification failed.');
    this.name = 'TokenVerificationError';
  }
}

const DEFAULT_CLOCK_TOLERANCE_SECONDS = 5;

/**
 * Verifies OIDC access or identity tokens against a provider's published keys.
 *
 * The JWKS is fetched lazily and cached by `jose`, including key rotation — so a provider rolling
 * its signing key does not require a redeploy, and a cold start does not fetch keys until the first
 * request that needs them.
 */
export class OidcVerifier {
  readonly #config: OidcConfig;
  readonly #jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(config: OidcConfig) {
    this.#config = config;
    const uri = config.jwksUri ?? `${config.issuer.replace(/\/+$/, '')}/.well-known/jwks.json`;
    this.#jwks = createRemoteJWKSet(new URL(uri));
  }

  async verify(token: string): Promise<VerifiedIdentity> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.#jwks, {
        issuer: this.#config.issuer,
        audience: this.#config.audience,
        clockTolerance: this.#config.clockToleranceSeconds ?? DEFAULT_CLOCK_TOLERANCE_SECONDS,
      }));
    } catch {
      // Deliberately swallows the reason. `jose` distinguishes expired from malformed from wrong
      // audience; the caller must not, and neither must a log line an attacker can trigger.
      throw new TokenVerificationError();
    }

    const subject = payload.sub;
    if (typeof subject !== 'string' || subject === '') {
      // A token with no subject cannot identify anyone. Accepting it would authenticate "somebody".
      throw new TokenVerificationError();
    }

    return {
      subject,
      provider: `oidc:${this.#config.issuer}`,
      ...extractVerifiedEmail(payload),
    };
  }
}

/**
 * The email claim, and only when the provider says it is verified.
 *
 * An unverified email is an address the person typed, not one they proved they control. Treating it
 * as identity is how account takeover by email collision happens.
 */
function extractVerifiedEmail(payload: JWTPayload): { email?: string } {
  const email = payload['email'];
  const verified = payload['email_verified'];
  if (typeof email === 'string' && email !== '' && verified === true) return { email };
  return {};
}

/**
 * Pulls a bearer token out of an `authorization` header.
 *
 * Returns `undefined` rather than throwing: a missing header is "not authenticated", which the
 * resolver already handles, and is not the same as a malformed token.
 */
export function bearerToken(headers: ReadonlyMap<string, string>): string | undefined {
  const header = headers.get('authorization');
  if (header === undefined) return undefined;
  const match = /^Bearer (.+)$/i.exec(header.trim());
  return match?.[1];
}
