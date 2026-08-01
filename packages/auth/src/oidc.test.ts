/**
 * OIDC verification, against locally generated keys.
 *
 * No network: a real key pair is generated per run and the JWKS is served from memory. That keeps
 * these tests fast and deterministic, and it means they assert the *verification*, not a provider's
 * uptime.
 *
 * Every test is a rejection except one. That ratio is the point — an authentication layer that
 * accepts the right token but also accepts three wrong ones passes its happy path perfectly.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair, type JWK, type KeyObject } from 'jose';
import { OidcVerifier, TokenVerificationError, bearerToken } from './oidc.ts';

const ISSUER = 'https://issuer.example.invalid';
const AUDIENCE = 'zentavio-web';

let privateKey: KeyObject;
let otherPrivateKey: KeyObject;
let jwks: { keys: JWK[] };

/**
 * A verifier pointed at an in-memory JWKS.
 *
 * `jose` fetches the JWKS over HTTP, so the fetch is intercepted rather than the library mocked —
 * the code under test is the real `createRemoteJWKSet`, including its caching.
 */
function verifier(overrides: Partial<{ issuer: string; audience: string }> = {}): OidcVerifier {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(jwks), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

  return new OidcVerifier({
    issuer: overrides.issuer ?? ISSUER,
    audience: overrides.audience ?? AUDIENCE,
    jwksUri: `${ISSUER}/.well-known/jwks.json`,
  });
}

interface TokenOptions {
  readonly issuer?: string;
  readonly audience?: string;
  readonly subject?: string | undefined;
  readonly expiresIn?: string;
  readonly key?: KeyObject;
  readonly claims?: Record<string, unknown>;
}

async function token(options: TokenOptions = {}): Promise<string> {
  let jwt = new SignJWT({ ...options.claims })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(options.issuer ?? ISSUER)
    .setAudience(options.audience ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? '5m');

  if (options.subject !== undefined) jwt = jwt.setSubject(options.subject);
  return jwt.sign(options.key ?? privateKey);
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  const other = await generateKeyPair('RS256');
  privateKey = pair.privateKey as KeyObject;
  otherPrivateKey = other.privateKey as KeyObject;

  jwks = { keys: [{ ...(await exportJWK(pair.publicKey)), alg: 'RS256', use: 'sig' }] };
});

describe('a valid token', () => {
  it('yields the subject and the provider, shaped for the users table', async () => {
    const identity = await verifier().verify(await token({ subject: 'user_abc123' }));

    expect(identity.subject).toBe('user_abc123');
    // Matches `users.auth_provider`, whose documented form is 'oidc:<issuer>'.
    expect(identity.provider).toBe(`oidc:${ISSUER}`);
  });
});

describe('rejections', () => {
  it('refuses a token signed by a different key', async () => {
    // The forged-token case. Without signature verification everything below is decoration.
    await expect(
      verifier().verify(await token({ subject: 'x', key: otherPrivateKey })),
    ).rejects.toBeInstanceOf(TokenVerificationError);
  });

  it('refuses a token from another issuer', async () => {
    // Without this, any provider's validly-signed token is accepted — including one the attacker
    // controls and can mint freely.
    await expect(
      verifier().verify(await token({ subject: 'x', issuer: 'https://evil.example.invalid' })),
    ).rejects.toBeInstanceOf(TokenVerificationError);
  });

  it('refuses a token minted for a different audience', async () => {
    // The check most often left out: a token for another application of the SAME provider is
    // correctly signed and correctly issued, and must still be refused here.
    await expect(
      verifier().verify(await token({ subject: 'x', audience: 'some-other-app' })),
    ).rejects.toBeInstanceOf(TokenVerificationError);
  });

  it('refuses an expired token', async () => {
    await expect(
      verifier().verify(await token({ subject: 'x', expiresIn: '-1m' })),
    ).rejects.toBeInstanceOf(TokenVerificationError);
  });

  it('refuses a token with no subject, rather than authenticating "somebody"', async () => {
    await expect(verifier().verify(await token({}))).rejects.toBeInstanceOf(TokenVerificationError);
  });

  it('refuses garbage', async () => {
    for (const bad of ['', 'not.a.token', 'Bearer x', 'a.b.c']) {
      await expect(verifier().verify(bad)).rejects.toBeInstanceOf(TokenVerificationError);
    }
  });

  it('gives the same error for every reason', async () => {
    // Distinguishing expired from forged from wrong-audience is a probing oracle, and useless to a
    // legitimate client.
    const messages = new Set<string>();
    for (const bad of [
      await token({ subject: 'x', key: otherPrivateKey }),
      await token({ subject: 'x', expiresIn: '-1m' }),
      await token({ subject: 'x', audience: 'other' }),
    ]) {
      await verifier()
        .verify(bad)
        .catch((error: unknown) => messages.add((error as Error).message));
    }
    expect(messages.size).toBe(1);
  });
});

describe('the email claim', () => {
  it('is taken only when the provider says it is verified', async () => {
    const identity = await verifier().verify(
      await token({ subject: 'x', claims: { email: 'ada@example.invalid', email_verified: true } }),
    );
    expect(identity.email).toBe('ada@example.invalid');
  });

  it('is ignored when unverified, because that is an address someone typed', async () => {
    // Treating an unverified address as identity is how account takeover by email collision works.
    const identity = await verifier().verify(
      await token({ subject: 'x', claims: { email: 'ada@example.invalid', email_verified: false } }),
    );
    expect(identity.email).toBeUndefined();
  });

  it('is ignored when the provider does not assert verification at all', async () => {
    const identity = await verifier().verify(
      await token({ subject: 'x', claims: { email: 'ada@example.invalid' } }),
    );
    expect(identity.email).toBeUndefined();
  });
});

describe('bearerToken', () => {
  it('extracts a bearer token', () => {
    expect(bearerToken(new Map([['authorization', 'Bearer abc.def.ghi']]))).toBe('abc.def.ghi');
  });

  it('is case-insensitive about the scheme, as RFC 6750 requires', () => {
    expect(bearerToken(new Map([['authorization', 'bearer abc']]))).toBe('abc');
  });

  it('returns undefined for a missing or non-bearer header', () => {
    expect(bearerToken(new Map())).toBeUndefined();
    expect(bearerToken(new Map([['authorization', 'Basic abc']]))).toBeUndefined();
  });
});
