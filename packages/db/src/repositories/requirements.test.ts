import { describe, expect, it } from 'vitest';
import { createCompileOnlyDb } from '../client.ts';
import {
  RequirementInvariantError,
  insertRequirement,
  requirementsAsOf,
  staleRequirements,
  supersedeRequirement,
  validateRequirement,
  type NewRequirement,
} from './requirements.ts';

// Two kinds of assertion here, and neither replaces an integration test:
//   - the guards reject what they should, before a round trip
//   - the compiled SQL is what we intend to send, with parameters bound rather than interpolated
// What PostgreSQL does with that SQL is unverified until a database exists.

const db = createCompileOnlyDb();

const immigrationRow: NewRequirement = {
  id: '01J8Z000000000000000000000',
  requirement_id: 'de.eu-blue-card.salary-threshold.it',
  domain: 'immigration',
  imposed_by: 'destination',
  jurisdiction: 'DE',
  subdivision: null,
  pathway_id: 'de.eu-blue-card',
  profession: null,
  kind: 'threshold',
  value: { amount: 43759.8, currency: 'EUR', period: 'year' },
  evaluation: 'numeric-gte',
  source_tier: 1,
  source_url: 'https://official.invalid/blue-card',
  source_document: null,
  retrieved_at: '2026-07-14T00:00:00Z',
  authority: 'Federal immigration authority',
  authority_url: 'https://official.invalid',
  effective_from: '2026-01-01',
  effective_to: null,
  version: '2026.1',
  supersedes: null,
  contested_note: null,
  refresh_after: '2027-01-01',
};

const recognitionRow: NewRequirement = {
  ...immigrationRow,
  id: '01J8Z000000000000000000001',
  requirement_id: 'de.nursing.licence-recognition',
  domain: 'recognition',
  pathway_id: null,
  profession: 'registered-nurse',
  kind: 'assessment',
  evaluation: 'manual',
};

describe('tier-1 enforcement', () => {
  it('rejects any tier other than 1', () => {
    const errors = validateRequirement({ ...immigrationRow, source_tier: 2 });
    expect(errors.map((e) => e.rule)).toContain('ck_req__tier_one');
  });

  it('rejects tier 1 claims with no source url', () => {
    const errors = validateRequirement({ ...immigrationRow, source_url: '   ' });
    expect(errors.map((e) => e.rule)).toContain('source_url');
  });

  it('accepts a well-formed tier-1 requirement', () => {
    expect(validateRequirement(immigrationRow)).toEqual([]);
  });
});

describe('authority', () => {
  it('is required, because "who do I contact?" must be answerable', () => {
    const errors = validateRequirement({ ...immigrationRow, authority: '' });
    expect(errors.map((e) => e.rule)).toContain('authority');
  });
});

describe('scope must match domain', () => {
  it('rejects an immigration requirement with no pathway', () => {
    const errors = validateRequirement({ ...immigrationRow, pathway_id: null });
    expect(errors.map((e) => e.rule)).toContain('ck_req__scope');
  });

  it('rejects a recognition requirement with no profession', () => {
    // A licence rule belongs to a profession and a regulatory body, not to a visa pathway. This is
    // the modelling consequence ADR-0010's acceptance surfaced.
    const errors = validateRequirement({ ...recognitionRow, profession: null });
    expect(errors.map((e) => e.rule)).toContain('ck_req__scope');
  });

  it('accepts a recognition requirement scoped by profession with no pathway', () => {
    expect(validateRequirement(recognitionRow)).toEqual([]);
  });

  it('does not require either for an authentication requirement', () => {
    const errors = validateRequirement({
      ...immigrationRow,
      domain: 'authentication',
      pathway_id: null,
      profession: null,
    });
    expect(errors).toEqual([]);
  });
});

describe('contested requirements', () => {
  it('rejects contested with no note', () => {
    // An ambiguity must be written down, never resolved by picking the friendlier reading.
    const errors = validateRequirement({ ...immigrationRow, contested: true });
    expect(errors.map((e) => e.rule)).toContain('ck_req__contested_note');
  });

  it('accepts contested with a note', () => {
    expect(
      validateRequirement({
        ...immigrationRow,
        contested: true,
        contested_note: 'the portal states two thresholds for the same occupation class',
      }),
    ).toEqual([]);
  });
});

describe('validity window', () => {
  it('rejects effective_to before effective_from', () => {
    const errors = validateRequirement({
      ...immigrationRow,
      effective_from: '2026-06-01',
      effective_to: '2026-01-01',
    });
    expect(errors.map((e) => e.rule)).toContain('ck_req__validity');
  });
});

describe('error reporting', () => {
  it('reports every violation at once rather than the first', () => {
    const errors = validateRequirement({
      ...immigrationRow,
      source_tier: 4,
      authority: '',
      pathway_id: null,
    });
    expect(errors).toHaveLength(3);
  });

  it('insert throws naming every broken rule', () => {
    try {
      insertRequirement(db, { ...immigrationRow, source_tier: 3, authority: '' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(RequirementInvariantError);
      const message = (error as RequirementInvariantError).message;
      expect(message).toContain('ck_req__tier_one');
      expect(message).toContain('authority');
    }
  });

  it('insert compiles to a parameterised statement for a valid row', () => {
    const compiled = insertRequirement(db, immigrationRow).compile();

    expect(compiled.sql).toContain('insert into "requirements"');
    // Values are bound, not interpolated — the difference between a query and an injection.
    expect(compiled.sql).toContain('$1');
    expect(compiled.parameters).toContain('de.eu-blue-card.salary-threshold.it');
    expect(compiled.sql).not.toContain('de.eu-blue-card.salary-threshold.it');
  });
});

describe('as-of queries', () => {
  it('bounds both ends of the validity window', () => {
    const compiled = requirementsAsOf(db, { pathwayId: 'de.eu-blue-card' }, '2025-06-01').compile();

    // A verdict given last year must still be explicable against the rules as they stood then, so
    // the query cannot simply filter on effective_to is null.
    expect(compiled.sql).toContain('"effective_from" <=');
    expect(compiled.sql).toContain('"effective_to" is null');
    expect(compiled.sql).toContain('"effective_to" >=');
    expect(compiled.parameters).toContain('2025-06-01');
  });

  it('scopes by profession for a recognition lookup', () => {
    const compiled = requirementsAsOf(
      db,
      { profession: 'registered-nurse', jurisdiction: 'DE' },
      '2026-07-28',
    ).compile();

    expect(compiled.sql).toContain('"profession" =');
    expect(compiled.sql).toContain('"jurisdiction" =');
    expect(compiled.parameters).toContain('registered-nurse');
  });

  it('omits a scope filter that was not supplied', () => {
    const compiled = requirementsAsOf(db, {}, '2026-07-28').compile();
    expect(compiled.sql).not.toContain('"pathway_id" =');
    expect(compiled.sql).not.toContain('"profession" =');
  });
});

describe('supersede', () => {
  const next: NewRequirement = {
    ...immigrationRow,
    id: '01J8Z000000000000000000002',
    version: '2027.1',
    effective_from: '2027-01-01',
    supersedes: immigrationRow.id,
  };

  it('closes the old row rather than updating its value', () => {
    const { close } = supersedeRequirement(
      db,
      { id: immigrationRow.id, closeOn: '2026-12-31' },
      next,
    );
    const compiled = close.compile();

    // Only effective_to is set. A value UPDATE would destroy the explanation for a past answer.
    expect(compiled.sql).toContain('set "effective_to" =');
    expect(compiled.sql).not.toContain('"value"');
    // Guards against closing an already-closed row.
    expect(compiled.sql).toContain('"effective_to" is null');
  });

  it('refuses a replacement that does not point at what it supersedes', () => {
    expect(() =>
      supersedeRequirement(db, { id: immigrationRow.id, closeOn: '2026-12-31' }, immigrationRow),
    ).toThrow(/version chain breaks/);
  });

  it('validates the replacement too', () => {
    expect(() =>
      supersedeRequirement(
        db,
        { id: immigrationRow.id, closeOn: '2026-12-31' },
        { ...next, source_tier: 2 },
      ),
    ).toThrow(/ck_req__tier_one/);
  });
});

describe('staleness', () => {
  it('finds live requirements past their refresh window', () => {
    const compiled = staleRequirements(db, '2027-06-01').compile();

    expect(compiled.sql).toContain('"effective_to" is null');
    expect(compiled.sql).toContain('"refresh_after" <');
  });
});
