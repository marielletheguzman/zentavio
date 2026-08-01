/**
 * The parts of `migrate.ts` that are decidable without a database.
 *
 * The command's real behaviour — applying, refusing, idempotence — is covered by the integration
 * suite against a live PostgreSQL, because `docs/development/testing.md` forbids mocking it. What
 * is left here is argument parsing and the credential redaction, and the second one is the reason
 * this file exists: a connection string printed in full is a leaked password, and that is exactly
 * the kind of mistake a unit test catches before a CI log does.
 */

import { describe, expect, it } from 'vitest';
import { EXIT, describeTarget, parseFlags } from './migrate.ts';

describe('parseFlags', () => {
  it('defaults to applying, not planning', () => {
    expect(parseFlags([])).toEqual({ dryRun: false, help: false });
  });

  it('recognises --dry-run', () => {
    expect(parseFlags(['--dry-run']).dryRun).toBe(true);
  });

  it('recognises --help and -h', () => {
    expect(parseFlags(['--help']).help).toBe(true);
    expect(parseFlags(['-h']).help).toBe(true);
  });

  it('throws on an unknown flag rather than ignoring it', () => {
    // A silently dropped --dry-run applies migrations. That failure is unrecoverable in a way a
    // usage error is not.
    expect(() => parseFlags(['--drynrun'])).toThrow();
  });

  it('throws on a positional argument', () => {
    // `migrate up` and `migrate 3` both look plausible and mean nothing here.
    expect(() => parseFlags(['up'])).toThrow();
  });
});

describe('describeTarget', () => {
  it('never includes the password', () => {
    const described = describeTarget('postgres://zentavio:hunter2@db.internal:5432/zentavio');
    expect(described).not.toContain('hunter2');
    expect(described).not.toContain('zentavio:');
    expect(described).toBe('db.internal:5432/zentavio');
  });

  it('defaults the port when the URL omits it', () => {
    expect(describeTarget('postgres://user:pw@localhost/zentavio')).toBe('localhost:5432/zentavio');
  });

  it('reports a missing database name rather than printing an empty path', () => {
    expect(describeTarget('postgres://user:pw@localhost:5432')).toBe('localhost:5432/(none)');
  });

  it('does not fall through to the original string when the URL will not parse', () => {
    // The failure mode this guards: an unparseable string containing a password being printed
    // verbatim because the parse threw.
    expect(describeTarget('not a url with hunter2 in it')).toBe('(unparseable connection string)');
  });
});

describe('EXIT', () => {
  it('separates a usage error from a failure', () => {
    // A script that retries on failure must not retry on a typo.
    expect(EXIT.USAGE).not.toBe(EXIT.FAILED);
    expect(EXIT.OK).toBe(0);
  });
});
