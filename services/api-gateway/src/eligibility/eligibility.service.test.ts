import type { Kysely } from 'kysely';
import type { Database } from '@zentavio/db';
import { describe, expect, it, vi } from 'vitest';

import type { EligibilityClient, EligibilityOutcome } from './eligibility-client.ts';
import { EligibilityService } from './eligibility.service.ts';

/**
 * A database stub shaped like the four reads the service makes. Compile-only: the real queries are
 * covered by the integration suite, and what is under test here is the taxonomy — which failures
 * are answers and which are ours — plus which rules get gathered.
 *
 * **Branches on the table name**, because ADR-0029 made that distinction load-bearing: retrieval is
 * now three requirement reads rather than one, and a stub that answered every `selectAll` with the
 * same array could not tell a pathway rule from a recognition rule. It answered `facts` to both
 * before, which is why `rules` was dead.
 *
 * `licenceScopeForUser` joins `careers`, so `user_targets` grows an `innerJoin` branch.
 * `undefined` is a person with no target — the common case, and **not** the same as a track that is
 * not gated.
 */
function stubDb(
  rules: unknown[] = [],
  facts: unknown[] = [],
  licence?: { readonly profession: string | null; readonly licenceGated: boolean },
  pathway?: { readonly pathway_id: string; readonly jurisdiction: string },
  /** Answers the profession and origin gathers, keyed by the `jurisdiction` each one scopes to. */
  byJurisdiction: Readonly<Record<string, unknown[]>> = {},
): Kysely<Database> {
  const chain = <T>(result: T, onWhere?: (column: string, value: unknown) => void) => ({
    where: function where(column: unknown, _operator?: unknown, value?: unknown) {
      if (typeof column === 'string' && onWhere !== undefined) onWhere(column, value);
      return this;
    },
    orderBy: function orderBy() {
      return this;
    },
    limit: function limit() {
      return this;
    },
    execute: async () => result,
    executeTakeFirst: async () => result,
  });

  /**
   * A requirements read answers by what it scoped to: a `pathway_id` is the pathway gather, a
   * `jurisdiction` is one of the two ADR-0029 added. Captured off the `where` calls because that is
   * the only place the distinction exists.
   */
  const requirementsChain = () => {
    let jurisdiction: string | undefined;
    let scopedToPathway = false;
    const link: Record<string, unknown> = {
      where(column: unknown, _operator?: unknown, value?: unknown) {
        if (column === 'pathway_id') scopedToPathway = true;
        if (column === 'jurisdiction' && typeof value === 'string') jurisdiction = value;
        return link;
      },
      orderBy: () => link,
      limit: () => link,
      execute: async () =>
        scopedToPathway ? rules : jurisdiction === undefined ? [] : byJurisdiction[jurisdiction] ?? [],
      executeTakeFirst: async () => undefined,
    };
    return link;
  };

  return {
    selectFrom: (table: string) => ({
      selectAll: () => (table === 'requirements' ? requirementsChain() : chain(facts)),
      // `licenceScopeForUser` joins careers onto the target.
      innerJoin: () => ({ select: () => chain(licence) }),
      // `pathwayById` selects columns directly off the table.
      select: () => chain(pathway),
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

  it('sends licence_gated from the targeted career, never a default', async () => {
    // **The regression this file exists to hold.** `licence_gated` was an optional argument and no
    // caller ever passed it, so `ai/career-roadmap`'s refusal to give a licence-gated profession a
    // visa-only verdict could not fire — the guard was implemented, tested in `ai/`, and
    // unreachable in production. A nurse would have received the visa answer.
    const client = stubClient({ kind: 'evaluated', response: verdict });
    const service = new EligibilityService(
      stubDb([], [], { profession: 'registered-nurse', licenceGated: true }),
      client,
    );

    await service.evaluate('user-1', 'de.eu-blue-card', '2026-06-01');

    expect(client.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({ licence_gated: true }),
    );
  });

  it('sends licence_gated false when the person has no target at all', async () => {
    // No target is not "not gated" — there is no track to be gated. False is honest here because
    // nothing has claimed otherwise, and eligibility for a pathway is still answerable.
    const client = stubClient({ kind: 'evaluated', response: verdict });
    const service = new EligibilityService(stubDb(), client);

    await service.evaluate('user-1', 'de.eu-blue-card', '2026-06-01');

    expect(client.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({ licence_gated: false }),
    );
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

/**
 * ADR-0029's retrieval half: the person is subject to three sets of rules, and asking only what the
 * pathway requires returns one of them. These assert which rules reach the evaluator — never what
 * it decides about them.
 */
describe('EligibilityService gathers across domains (ADR-0029)', () => {
  const rule = (id: string, requirementId: string, domain: string) => ({
    id,
    requirement_id: requirementId,
    domain,
    imposed_by: domain === 'employment_clearance' ? 'origin' : 'destination',
    kind: 'eligibility',
    evaluation: 'boolean',
    value: null,
    applies_to: {},
    needs_input: [],
    authority: 'An authority',
    source_url: 'https://official.invalid/x',
    effective_from: '2026-01-01',
    effective_to: null,
    refresh_after: null,
    contested: false,
    contested_note: null,
  });

  const nurse = { profession: 'registered-nurse', licenceGated: true };
  const germany = { pathway_id: 'de.eu-blue-card', jurisdiction: 'DE' };
  const qualifiedInPh = [
    { kind_key: 'qualification_awarded_in', value: 'PH', basis: 'self_reported' },
  ];

  const idsSentTo = (client: EligibilityClient): string[] => {
    const call = vi.mocked(client.evaluate).mock.calls[0]?.[0] as
      | { requirements: { requirement_id: string }[] }
      | undefined;
    return (call?.requirements ?? []).map((requirement) => requirement.requirement_id);
  };

  it("gathers the destination's rules for the person's profession, not just the pathway's", async () => {
    // The half that made a licence-gated verdict unanswerable: `licence_gated` reached the
    // evaluator with no recognition rule to reason about, because a recognition row carries a
    // profession and no pathway, so no pathway-scoped query could ever return it.
    const client = stubClient({ kind: 'evaluated', response: verdict });
    const service = new EligibilityService(
      stubDb(
        [rule('1', 'de.eu-blue-card.salary-threshold', 'immigration')],
        [],
        nurse,
        germany,
        { DE: [rule('2', 'de.nursing.licence-recognition', 'recognition')] },
      ),
      client,
    );

    await service.evaluate('user-1', 'de.eu-blue-card', '2026-06-01');

    expect(idsSentTo(client)).toEqual([
      'de.eu-blue-card.salary-threshold',
      'de.nursing.licence-recognition',
    ]);
  });

  it("gathers the origin state's own duties once the person says where they qualified", async () => {
    // A Philippine clearance is imposed by PH and is invisible to every query scoped to DE.
    const client = stubClient({ kind: 'evaluated', response: verdict });
    const service = new EligibilityService(
      stubDb([rule('1', 'de.eu-blue-card.salary-threshold', 'immigration')], qualifiedInPh, nurse, germany, {
        DE: [],
        PH: [rule('3', 'ph.overseas-employment.clearance', 'employment_clearance')],
      }),
      client,
    );

    await service.evaluate('user-1', 'de.eu-blue-card', '2026-06-01');

    expect(idsSentTo(client)).toContain('ph.overseas-employment.clearance');
  });

  it('gathers no origin rules when the person has not said where they qualified', async () => {
    // Not a failure. No origin is gathered, the question stays open, and `needs_input` is what
    // names it. Inferring an origin from anything else would be inventing the fact that decides
    // which rules apply to somebody.
    const client = stubClient({ kind: 'evaluated', response: verdict });
    const service = new EligibilityService(
      stubDb([rule('1', 'de.eu-blue-card.salary-threshold', 'immigration')], [], nurse, germany, {
        DE: [],
        PH: [rule('3', 'ph.overseas-employment.clearance', 'employment_clearance')],
      }),
      client,
    );

    await service.evaluate('user-1', 'de.eu-blue-card', '2026-06-01');

    expect(idsSentTo(client)).not.toContain('ph.overseas-employment.clearance');
  });

  it('matches the origin jurisdiction whatever case the person typed', async () => {
    // The kind is free text, so `ph` is a real answer. Upper-cased for the query only — this is not
    // the `applies_to.origin_jurisdiction` matching, which is the evaluator's.
    const client = stubClient({ kind: 'evaluated', response: verdict });
    const service = new EligibilityService(
      stubDb([], [{ kind_key: 'qualification_awarded_in', value: ' ph ', basis: 'self_reported' }], nurse, germany, {
        DE: [],
        PH: [rule('3', 'ph.overseas-employment.clearance', 'employment_clearance')],
      }),
      client,
    );

    await service.evaluate('user-1', 'de.eu-blue-card', '2026-06-01');

    expect(idsSentTo(client)).toContain('ph.overseas-employment.clearance');
  });

  it('sends a rule once when two gathers reach it', async () => {
    // Sent twice it would be evaluated twice and could be counted twice in a blocker list.
    const client = stubClient({ kind: 'evaluated', response: verdict });
    const shared = rule('2', 'de.nursing.licence-recognition', 'recognition');
    const service = new EligibilityService(
      stubDb([shared], [], nurse, germany, { DE: [shared] }),
      client,
    );

    await service.evaluate('user-1', 'de.eu-blue-card', '2026-06-01');

    expect(idsSentTo(client)).toEqual(['de.nursing.licence-recognition']);
  });

  it("sends the pathway's jurisdiction as the destination, from the row not the id", async () => {
    // The evaluator needs it to place a rule an origin state scopes by destination (ADR-0029).
    // Read from the column because the id is a naming convention and the column is the fact.
    const client = stubClient({ kind: 'evaluated', response: verdict });
    const service = new EligibilityService(stubDb([], [], nurse, germany, {}), client);

    await service.evaluate('user-1', 'de.eu-blue-card', '2026-06-01');

    expect(client.evaluate).toHaveBeenCalledWith(expect.objectContaining({ destination: 'DE' }));
  });

  it('sends a null destination when the pathway is not on file', async () => {
    // Null rather than a guess. A destination-scoped rule then stays undetermined, which is what a
    // fabricated destination would have hidden.
    const client = stubClient({ kind: 'evaluated', response: verdict });
    const service = new EligibilityService(stubDb([], [], nurse, undefined, {}), client);

    await service.evaluate('user-1', 'de.eu-blue-card', '2026-06-01');

    expect(client.evaluate).toHaveBeenCalledWith(expect.objectContaining({ destination: null }));
  });

  it('gathers only the pathway when the person has no target profession', async () => {
    const client = stubClient({ kind: 'evaluated', response: verdict });
    const service = new EligibilityService(
      stubDb([rule('1', 'de.eu-blue-card.salary-threshold', 'immigration')], [], undefined, germany, {
        DE: [rule('2', 'de.nursing.licence-recognition', 'recognition')],
      }),
      client,
    );

    await service.evaluate('user-1', 'de.eu-blue-card', '2026-06-01');

    expect(idsSentTo(client)).toEqual(['de.eu-blue-card.salary-threshold']);
  });
});
