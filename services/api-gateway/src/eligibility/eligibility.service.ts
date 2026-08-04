/**
 * Gathering everything an eligibility verdict needs, and deciding what each failure means.
 *
 * As with the gap, the interesting work is the taxonomy rather than the orchestration. Three
 * things can go wrong before a verdict exists, and they are three different sentences:
 *
 * * nobody has ingested any rule for this pathway on this date
 * * the evaluator refused the request — our defect
 * * the evaluator is down
 *
 * Only the first is an answer. Collapsing them into "something went wrong" is how a product stops
 * being usable.
 *
 * **The gateway orchestrates; it never decides.** No comparison, no aggregation, no reasoning about
 * what `undetermined` means happens here. That all lives in `ai/career-roadmap`, which is testable
 * without a database and has no country in it.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { currentFacts, requirementsAsOf, type Database } from '@zentavio/db';
import type { EligibilityResponseWire, GapResponseWire, ViabilityResponseWire } from '@zentavio/types';

import type { EligibilityClient } from './eligibility-client.ts';
import { DATABASE, ELIGIBILITY_CLIENT } from '../tokens.ts';

export type EligibilityOutcomeForUser =
  | { readonly kind: 'evaluated'; readonly verdict: EligibilityResponseWire }
  | { readonly kind: 'unavailable'; readonly reason: string };

export type ViabilityOutcomeForUser =
  | { readonly kind: 'paired'; readonly viability: ViabilityResponseWire }
  | { readonly kind: 'unavailable'; readonly reason: string };

/**
 * The employability half, from a computed gap.
 *
 * The **band is carried, never a midpoint** — its width is how much of the number rests on
 * assertion, which is why M1c added it. `items.length` is the gap itself: how far the person is
 * from the work, which is what "employability binds" has to be able to say.
 */
function toEmployability(gap: GapResponseWire, asOf: string): Readonly<Record<string, unknown>> {
  return {
    status: gap.status,
    score_low: gap.readiness.score_low,
    score_high: gap.readiness.score_high,
    missing_count: gap.items.length,
    reason: gap.reason,
    as_of: asOf,
  };
}

/**
 * A `date` column arrives as a `Date` at **local** midnight. `toISOString()` shifts it back a day
 * anywhere east of UTC, so `2026-12-31` becomes `2026-12-30` — a bug CI cannot catch because CI
 * runs UTC. Local date parts are what the column actually holds.
 */
function isoDate(value: unknown): string {
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${String(value.getFullYear())}-${month}-${day}`;
}

@Injectable()
export class EligibilityService {
  readonly #db: Kysely<Database>;
  readonly #client: EligibilityClient;
  readonly #logger = new Logger(EligibilityService.name);

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(ELIGIBILITY_CLIENT) client: EligibilityClient,
  ) {
    this.#db = db;
    this.#client = client;
  }

  /**
   * Evaluate a pathway for a person, as of a date.
   *
   * `asOf` is supplied by the caller and never defaulted here. A verdict without a stated date is
   * unreproducible, and the evaluator refuses one — defaulting it in the gateway would work around
   * a refusal that exists on purpose.
   */
  async evaluate(
    userId: string,
    pathwayId: string,
    asOf: string,
    options: { readonly licenceGated?: boolean } = {},
  ): Promise<EligibilityOutcomeForUser> {
    const outcome = await this.#client.evaluate(await this.#inputs(userId, pathwayId, asOf, options));
    return this.#interpret(outcome, (response) => ({ kind: 'evaluated' as const, verdict: response }));
  }

  /**
   * Both axes, paired, with the binding constraint named (ADR-0022).
   *
   * **One call**, not `/evaluate` followed by a compose: two calls would evaluate eligibility
   * twice and could disagree about what was checked. The gateway supplies both halves and
   * `ai/career-roadmap` pairs them, which keeps `ai/` stateless and stops one `ai/` service
   * calling another.
   */
  async viability(
    userId: string,
    pathwayId: string,
    asOf: string,
    gap: GapResponseWire,
    options: { readonly licenceGated?: boolean } = {},
  ): Promise<ViabilityOutcomeForUser> {
    const outcome = await this.#client.viability({
      ...(await this.#inputs(userId, pathwayId, asOf, options)),
      employability: toEmployability(gap, asOf),
    });
    return this.#interpret(outcome, (response) => ({ kind: 'paired' as const, viability: response }));
  }

  /** Turn a client outcome into a user-facing one, so both routes classify failures identically. */
  #interpret<TResponse, TOk extends { kind: string }>(
    outcome:
      | { kind: 'evaluated'; response: TResponse }
      | { kind: 'rejected'; code: string; message: string }
      | { kind: 'unavailable'; reason: string },
    ok: (response: TResponse) => TOk,
  ): TOk | { readonly kind: 'unavailable'; readonly reason: string } {
    if (outcome.kind === 'evaluated') return ok(outcome.response);

    if (outcome.kind === 'rejected') {
      // The service reserves 4xx for a malformed request, so reaching here means the gateway built
      // one. Our defect, never something to show a user as a verdict.
      this.#logger.error(
        `eligibility service rejected the request: ${outcome.code} (${outcome.message})`,
      );
      return { kind: 'unavailable', reason: 'rejected' };
    }

    this.#logger.warn(`eligibility service unavailable: ${outcome.reason}`);
    return { kind: 'unavailable', reason: outcome.reason };
  }

  /** Everything the evaluator needs, read once so both routes send identical inputs. */
  async #inputs(
    userId: string,
    pathwayId: string,
    asOf: string,
    options: { readonly licenceGated?: boolean },
  ) {
    const [rules, facts] = await Promise.all([
      requirementsAsOf(this.#db, { pathwayId }, asOf).execute(),
      currentFacts(this.#db, userId),
    ]);

    return {
      pathway_id: pathwayId,
      // Passed through as the evaluator's shape. The gateway does not interpret a rule; it hands
      // over what is stored and lets the service that owns the reasoning do the reasoning.
      requirements: rules.map((rule) => ({
        requirement_id: rule.requirement_id,
        domain: rule.domain,
        imposed_by: rule.imposed_by,
        kind: rule.kind,
        evaluation: rule.evaluation,
        value: rule.value,
        needs_input: rule.needs_input,
        authority: rule.authority,
        source_url: rule.source_url,
        effective_from: isoDate(rule.effective_from),
        effective_to: rule.effective_to === null ? null : isoDate(rule.effective_to),
        refresh_after: rule.refresh_after === null ? null : isoDate(rule.refresh_after),
        contested: rule.contested,
        contested_note: rule.contested_note,
      })),
      facts: facts.map((fact) => ({
        key: fact.kind_key,
        value: fact.value,
        basis: fact.basis,
      })),
      as_of: asOf,
      licence_gated: options.licenceGated ?? false,
    };
  }
}
