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
import {
  currentFacts,
  licenceScopeForUser,
  pathwayById,
  requirementsAsOf,
  type Database,
} from '@zentavio/db';
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

/** One row as `requirementsAsOf` returns it. Named so the gather can say what it carries. */
type RequirementRow = Awaited<ReturnType<ReturnType<typeof requirementsAsOf>['execute']>>[number];

/**
 * The country a person's qualification was awarded in, if they have told us.
 *
 * `undefined` when unanswered, and that is not a failure: no origin rules are gathered, the
 * recognition question stays unresolved, and `needs_input` names `qualification_awarded_in` as what
 * would resolve it. Guessing an origin from anything else — a résumé's addresses, a nationality we
 * do not hold — would be inventing the fact that decides which rules apply to somebody.
 *
 * Trimmed and upper-cased **for the query only**, because `requirements.jurisdiction` stores
 * `PH` and a person who typed `ph` should not silently match nothing. This is not the
 * `applies_to.origin_jurisdiction` matching, which is ADR-0029's third follow-up and lives in the
 * evaluator.
 */
function originOf(facts: Awaited<ReturnType<typeof currentFacts>>): string | undefined {
  const fact = facts.find((candidate) => candidate.kind_key === 'qualification_awarded_in');
  if (fact === undefined || typeof fact.value !== 'string') return undefined;
  const code = fact.value.trim().toUpperCase();
  return code === '' ? undefined : code;
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
  ): Promise<EligibilityOutcomeForUser> {
    const outcome = await this.#client.evaluate(await this.#inputs(userId, pathwayId, asOf));
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
  ): Promise<ViabilityOutcomeForUser> {
    const outcome = await this.#client.viability({
      ...(await this.#inputs(userId, pathwayId, asOf)),
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

  /**
   * The three sets of rules a person is actually subject to (ADR-0029).
   *
   * Retrieval used to ask one question — *what does this pathway require?* — and that is only the
   * immigration third of it. A Filipino nurse moving to Germany is subject to:
   *
   * * the **pathway's** rules, whatever her profession
   * * the **destination's rules for her profession** — German nursing recognition, which no
   *   pathway-scoped query returns because a recognition row carries a profession and no pathway
   * * the **origin state's own duties** — a Philippine clearance, imposed by `PH` and invisible to
   *   every query scoped to `DE`
   *
   * Missing the second is what made a licence-gated verdict unanswerable: `licence_gated` reached
   * the evaluator (#109) with no `recognition` row to reason about, so the guard fired on an empty
   * set. This widens the set. It does **not** decide anything about the rules it returns.
   *
   * **Nothing here filters on the person's origin.** Whether a gathered rule applies to somebody
   * with a Philippine qualification is `applies_to.origin_jurisdiction`, an absent key means it
   * applies regardless, and that matching belongs to the evaluator — ADR-0029's third follow-up,
   * deliberately not this one. Gathering more than applies is safe; the evaluator discards. Failing
   * to gather is not: a rule never fetched cannot be discarded, and its absence looks like
   * compliance.
   */
  async #gather(
    pathwayRules: readonly RequirementRow[],
    facts: Awaited<ReturnType<typeof currentFacts>>,
    licence: Awaited<ReturnType<typeof licenceScopeForUser>>,
    pathway: Awaited<ReturnType<typeof pathwayById>>,
    asOf: string,
  ): Promise<RequirementRow[]> {
    const profession = licence?.profession ?? undefined;
    const destination = pathway?.jurisdiction;
    const origin = originOf(facts);

    const [professionRules, originRules] = await Promise.all([
      // The destination's rules for this profession. Scoped to the destination so Luxembourg's
      // nursing rules cannot arrive in a German verdict, and exact on profession so another
      // occupation's recognition rules cannot either.
      profession !== undefined && destination !== undefined
        ? requirementsAsOf(this.#db, { jurisdiction: destination, profession }, asOf).execute()
        : [],
      // The origin state's duties. Widened to rules naming no profession, because an
      // overseas-employment clearance usually applies to every departing worker and dropping those
      // rows would tell the person nothing about a step they still have to take.
      origin !== undefined
        ? requirementsAsOf(
            this.#db,
            profession === undefined
              ? { jurisdiction: origin, imposedBy: 'origin' }
              : { jurisdiction: origin, imposedBy: 'origin', profession, includeProfessionless: true },
            asOf,
          ).execute()
        : [],
    ]);

    // A rule can be reached by more than one gather — a destination recognition rule for the
    // profession is also, on some pathways, a pathway rule. Sent twice it would be evaluated twice
    // and could be counted twice in a blocker list, so identity is the row's `id` and first arrival
    // wins. Order is stable rather than meaningful: the evaluator does not read order, and a
    // deterministic sequence is what makes a diff of two responses legible.
    const byId = new Map<string, RequirementRow>();
    for (const rule of [...pathwayRules, ...professionRules, ...originRules]) {
      if (!byId.has(rule.id)) byId.set(rule.id, rule);
    }

    return [...byId.values()].sort((a, b) => a.requirement_id.localeCompare(b.requirement_id));
  }

  /** Everything the evaluator needs, read once so both routes send identical inputs. */
  async #inputs(userId: string, pathwayId: string, asOf: string) {
    const [pathwayRules, facts, licence, pathway] = await Promise.all([
      requirementsAsOf(this.#db, { pathwayId }, asOf).execute(),
      currentFacts(this.#db, userId),
      // Read here rather than accepted as an argument. It used to be an optional parameter, and
      // no caller ever passed it — so `ai/career-roadmap`'s refusal to give a licence-gated
      // profession a visa-only verdict could not fire. An input that must never be omitted does
      // not belong in a signature that lets you omit it.
      licenceScopeForUser(this.#db, userId),
      pathwayById(this.#db, pathwayId),
    ]);

    const rules = await this.#gather(pathwayRules, facts, licence, pathway, asOf);

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
        // Carried, never interpreted. The evaluator reads `route` out of this (ADR-0024); the
        // gateway must not branch on one, or route semantics end up in two places.
        applies_to: rule.applies_to,
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
      // A person with no target is not "not gated" — there is no track to be gated. The verdict
      // is still answerable, and false is the honest value because nothing claims otherwise.
      licence_gated: licence?.licenceGated ?? false,
      // Where the pathway leads, so the evaluator can place a rule the origin state scopes by
      // destination. Read from the pathway row rather than parsed out of `pathwayId`: the id is a
      // naming convention and the column is the fact.
      destination: pathway?.jurisdiction ?? null,
    };
  }
}
