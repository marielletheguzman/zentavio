/**
 * The subject boundary.
 *
 * Every test here is about **refusal**, because that is the property that matters: an auth layer
 * that lets the wrong person through passes every happy-path test ever written.
 */

import { describe, expect, it } from 'vitest';
import {
  DEV_SUBJECT_HEADER,
  DenyAllSubjectResolver,
  InsecureDevSubjectResolver,
  UnauthenticatedError,
  assertOwns,
} from './subject.ts';

const USER = '019fbd2e-5857-7000-922f-fea29ad78870';
const OTHER = '019fbd55-2e29-7000-916c-4c1d0b5d4e0a';

const headers = (value?: string): ReadonlyMap<string, string> =>
  new Map(value === undefined ? [] : [[DEV_SUBJECT_HEADER, value]]);

describe('DenyAllSubjectResolver — the default', () => {
  it('refuses, because deny-by-default is the safe way to be misconfigured', async () => {
    // A missing configuration must produce a locked door, not an open one.
    await expect(new DenyAllSubjectResolver().resolve()).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});

describe('InsecureDevSubjectResolver', () => {
  const dev = (enabled: boolean, isProduction = false) =>
    new InsecureDevSubjectResolver({ enabled, isProduction });

  it('refuses when it was not explicitly enabled', async () => {
    await expect(dev(false).resolve(headers(USER))).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('refuses in production even when enabled', async () => {
    // Two independent conditions on purpose: a single guard around something this dangerous is a
    // single point of failure, and a misconfigured deployment must fail closed.
    await expect(dev(true, true).resolve(headers(USER))).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('refuses when the header is absent', async () => {
    await expect(dev(true).resolve(headers())).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('refuses a header that is not a uuid', async () => {
    // Without this, an arbitrary string reaches a query as a user id.
    for (const bad of ['', 'admin', "' OR 1=1 --", '00000000-0000-0000-0000-000000000000']) {
      await expect(dev(true).resolve(headers(bad))).rejects.toBeInstanceOf(UnauthenticatedError);
    }
  });

  it('marks what it produces as insecure, so it is visible in a log', async () => {
    const subject = await dev(true).resolve(headers(USER));
    expect(subject.userId).toBe(USER);
    expect(subject.authenticatedVia).toBe('insecure-dev');
  });
});

describe('assertOwns — the second check', () => {
  it('allows a subject to act on their own resource', () => {
    expect(() => assertOwns({ userId: USER, authenticatedVia: 'oidc' }, USER)).not.toThrow();
  });

  it('refuses a subject acting on someone else', () => {
    // The most common serious bug in an application of this shape: an authenticated user reading
    // another user's profile by changing an id.
    expect(() => assertOwns({ userId: USER, authenticatedVia: 'oidc' }, OTHER)).toThrow(
      UnauthenticatedError,
    );
  });

  it('does not distinguish "not yours" from "does not exist"', () => {
    // Distinguishing them tells an attacker which ids are real.
    const notYours = (() => {
      try {
        assertOwns({ userId: USER, authenticatedVia: 'oidc' }, OTHER);
      } catch (error) {
        return (error as Error).message;
      }
      return '';
    })();

    expect(notYours).toBe(new UnauthenticatedError().message);
  });
});
