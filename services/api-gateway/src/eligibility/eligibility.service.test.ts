import type { Kysely } from 'kysely';
import type { Database } from '@zentavio/db';
import { describe, expect, it, vi } from 'vitest';

import type { EligibilityClient, EligibilityOutcome } from './eligibility-client.ts';
import { EligibilityService } from './eligibility.service.ts';

/**
 * A database stub shaped like the two calls the service makes. Compile-only: the real queries are
 * covered by the integration suite, and what is under test here is the taxonomy — which failures
 * are answers and which are ours.
 */
function stubDb(rules: unknown[] = [], facts: unknown[] = []): Kysely<Database> {
  return {
    selectFrom: () => ({
      selectAll: () => ({
        where: function where() {
          return this;
        },
        orderBy: function orderBy() {
          return this;
        },
        execute: async () => facts,
      }),
      // `requirementsAsOf` builds through the same chain.
      _rules: rules,
    }),
  } as unknown as Kysely<Database>;
}

function stubClient(outcome: EligibilityOutcome): EligibilityClient {
  return { evaluate: vi.fn(async () => outcome) } as unknown as EligibilityClient;
}

const verdict = {
  pathway_id: 'de.eu-blue-card',
  status: 'undetermined' as const,
  requirements: [],
  blockers: [],
  needs_from_user: ['expected_gross_annual_salary_eur'],
  binding_domain: 'immigration',
  confidence: 'medium',
  as_of: '2026-06-01',
  disclaimer: 'Sourced official information, not legal advice.',
  notes: [],
  evaluator_version: '1.0.0',
};

describe('EligibilityService', () => {
  it('returns the verdict unchanged when the evaluator answers', async () => {
    // The gateway orchestrates and never decides. Reshaping a verdict here would put reasoning in
    // a layer that has a database and no tests for the reasoning.
    const service = new EligibilityService(stubDb(), stubClient({ kind: 'evaluated', response: verdict }));

    const outcome = await service.evaluate('user-1', 'de.eu-blue-card', '2026-06-01');

    expect(outcome).toEqual({ kind: 'evaluated', verdict });
  });

  it('passes the callers asOf through rather than defaulting it', async () => {
    const client = stubClient({ kind: 'evaluated', response: verdict });
    const service = new EligibilityService(stubDb(), client);

    await service.evaluate('user-1', 'de.eu-blue-card', '2025-03-04');

    expect(client.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({ as_of: '2025-03-04', pathway_id: 'de.eu-blue-card' }),
    );
  });

  it('treats a rejection as unavailable, never as an eligibility outcome', async () => {
    // The evaluator reserves 4xx for a malformed request, so reaching here means the gateway built
    // one. That is our defect and must never render as a verdict.
    const service = new EligibilityService(
      stubDb(),
      stubClient({ kind: 'rejected', code: 'VALIDATION_FAILED', message: 'as_of missing' }),
    );

    expect(await service.evaluate('user-1', 'p', '2026-06-01')).toEqual({
      kind: 'unavailable',
      reason: 'rejected',
    });
  });

  it('reports an unreachable evaluator as unavailable with its reason', async () => {
    const service = new EligibilityService(
      stubDb(),
      stubClient({ kind: 'unavailable', reason: 'timed out', retryable: true }),
    );

    expect(await service.evaluate('user-1', 'p', '2026-06-01')).toEqual({
      kind: 'unavailable',
      reason: 'timed out',
    });
  });

  it('sends a persons current facts, keyed the way the catalogue names them', async () => {
    const client = stubClient({ kind: 'evaluated', response: verdict });
    const service = new EligibilityService(
      stubDb([], [{ kind_key: 'expected_gross_annual_salary_eur', value: { amount: 60000 }, basis: 'self_reported' }]),
      client,
    );

    await service.evaluate('user-1', 'de.eu-blue-card', '2026-06-01');

    expect(client.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        facts: [
          {
            key: 'expected_gross_annual_salary_eur',
            value: { amount: 60000 },
            basis: 'self_reported',
          },
        ],
      }),
    );
  });
});
