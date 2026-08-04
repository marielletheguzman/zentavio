import { describe, expect, it } from 'vitest';

import { normalizeAlias, normalizeCompanyAlias } from './seed.ts';

/**
 * The resolution key for a company name.
 *
 * These assertions are the difference between one employer and two. A key that drifts makes
 * resolution miss silently, and a key that over-strips merges companies that are not the same —
 * the second is irrecoverable, because no later check can tell a wrong merge from a real one.
 */
describe('normalizeCompanyAlias', () => {
  it('resolves the same employer written with and without its legal form', () => {
    expect(normalizeCompanyAlias('Google Germany GmbH')).toBe(normalizeCompanyAlias('Google Germany'));
    expect(normalizeCompanyAlias('Acme Inc.')).toBe(normalizeCompanyAlias('Acme'));
    expect(normalizeCompanyAlias('Foo Ltd')).toBe(normalizeCompanyAlias('foo'));
  });

  it('strips a chain of suffixes from the end', () => {
    expect(normalizeCompanyAlias('Example Holdings Ltd Inc')).toBe('example holdings');
  });

  it('strips only from the end — a suffix inside a name is part of the name', () => {
    // "Ltd" here is not the legal form; removing it would rename the company.
    expect(normalizeCompanyAlias('Ltd Brands International')).toBe('ltd brands international');
  });

  it('never normalizes a name away to nothing', () => {
    // A company literally called "Company" must not produce an empty key: every empty key would
    // collide with every other, which is the worst possible merge.
    expect(normalizeCompanyAlias('Company')).toBe('company');
    expect(normalizeCompanyAlias('GmbH')).toBe('gmbh');
    expect(normalizeCompanyAlias('AG')).toBe('ag');
  });

  it('keeps distinct employers distinct', () => {
    // The failure that makes outcome data wrong in a way nobody can find later.
    expect(normalizeCompanyAlias('Acme Health')).not.toBe(normalizeCompanyAlias('Acme Healthcare'));
    expect(normalizeCompanyAlias('Alpha Systems')).not.toBe(normalizeCompanyAlias('Alpha Software'));
  });

  it('inherits casefolding, punctuation stripping and whitespace collapsing', () => {
    expect(normalizeCompanyAlias('  ACME   Health,  Inc. ')).toBe('acme health');
  });

  it('is idempotent — normalizing a key again returns the key', () => {
    // Ingestion re-normalizes stored values, and a function that moved on a second pass would make
    // a stored key stop matching itself.
    const once = normalizeCompanyAlias('Google Germany GmbH');
    expect(normalizeCompanyAlias(once)).toBe(once);
  });

  it('leaves the skill normalization untouched', () => {
    // `normalizeAlias` is shared with the skill graph and mirrored in Python. A legal suffix is
    // meaningless there, and changing it would break resolution on the other side of the boundary.
    expect(normalizeAlias('Acme Inc.')).toBe('acme inc');
  });
});
