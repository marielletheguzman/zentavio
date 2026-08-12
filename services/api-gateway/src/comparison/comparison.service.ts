/**
 * Gathering what four destinations and `REMOTE` are compared on.
 *
 * The orchestration is ordinary; two properties are not, and both are the reason this exists as its
 * own service rather than a loop in a controller.
 *
 * **One date, one readiness, one evaluator run.** Every destination is evaluated as of the same
 * `asOf` and against the same computed gap. A comparison whose rows were produced at different
 * moments, or against different profiles, compares nothing while looking like it compares
 * something.
 *
 * **A destination that could not be evaluated fails the whole comparison.** There is no cell state
 * meaning "we could not ask" — `unmodelled` says nothing is ingested, which would be a lie about a
 * connector that works — so a transport failure is a 503 for the page rather than a quietly
 * degraded row. ADR-0026's rule that missing data must never become negative evidence is exactly
 * what a partial comparison would break.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { activePathways, type Database } from '@zentavio/db';
import type { ComparisonWire, GapResponseWire } from '@zentavio/types';

import { composeComparison, type DestinationInput, type EmployabilityInput } from './compose.ts';
import { destinationCode, remoteDestination, toQuota } from './destinations.ts';
import { EligibilityService } from '../eligibility/eligibility.service.ts';
import { GapService } from '../gap/gap.service.ts';
import { DATABASE } from '../tokens.ts';

export type ComparisonOutcome =
  | { readonly kind: 'compared'; readonly comparison: ComparisonWire }
  /** No target chosen, or no profile: the same two answers the gap itself gives. */
  | { readonly kind: 'no-employability'; readonly reason: string }
  | { readonly kind: 'unavailable'; readonly reason: string };

/** The readiness half, computed once and shared. It has no jurisdiction in it (ADR-0028). */
function toEmployability(gap: GapResponseWire): EmployabilityInput {
  return {
    status: gap.status,
    missingCount: gap.items.length,
    reason: gap.reason,
  };
}

@Injectable()
export class ComparisonService {
  readonly #db: Kysely<Database>;
  readonly #eligibility: EligibilityService;
  readonly #gap: GapService;
  readonly #logger = new Logger(ComparisonService.name);

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    eligibility: EligibilityService,
    gap: GapService,
  ) {
    this.#db = db;
    this.#eligibility = eligibility;
    this.#gap = gap;
  }

  async compare(userId: string, asOf: string): Promise<ComparisonOutcome> {
    const gap = await this.#gap.currentGap(userId);

    if (gap.kind === 'unavailable') {
      return { kind: 'unavailable', reason: gap.reason };
    }

    if (gap.kind !== 'computed') {
      // Not a failure: the person has not chosen a track, or has no profile yet. Both are
      // answerable, and both make every row on the screen equally uninformative — so the surface
      // says which rather than rendering five destinations that all read `unmodelled`.
      return { kind: 'no-employability', reason: gap.kind };
    }

    const employability = toEmployability(gap.gap);
    const pathways = await activePathways(this.#db);

    // Sequential rather than concurrent: five evaluations against one small service, and a burst
    // of parallel requests buys nothing a person notices while making a timeout harder to attribute.
    const destinations: DestinationInput[] = [];
    let disclaimer: string | null = null;

    for (const pathway of pathways) {
      const outcome = await this.#eligibility.viability(
        userId,
        pathway.pathway_id,
        asOf,
        gap.gap,
      );

      if (outcome.kind === 'unavailable') {
        this.#logger.warn(
          `comparison abandoned: ${pathway.pathway_id} could not be evaluated (${outcome.reason})`,
        );
        return { kind: 'unavailable', reason: outcome.reason };
      }

      const { viability } = outcome;
      disclaimer ??= viability.disclaimer;

      destinations.push({
        destination: destinationCode(pathway),
        name: pathway.name,
        class: 'country',
        pathwayId: pathway.pathway_id,
        eligibility: viability.eligibility,
        // Passed through from `ai/career-roadmap`, never recomputed here. The gateway does not
        // decide what binds; it asked the service that does.
        binding: viability.binding,
        bindingReason: viability.binding_reason,
        employability,
        quota: toQuota(pathway.quota),
      });
    }

    destinations.push(remoteDestination(employability));

    return {
      kind: 'compared',
      comparison: composeComparison(
        destinations,
        asOf,
        // The evaluator's own wording, emitted verbatim as every eligibility answer is. With no
        // country evaluated there is none to carry, and `REMOTE` alone needs no immigration
        // disclaimer — but the sentence is not invented to fill the field.
        disclaimer ??
          'No immigration rules were evaluated, so nothing here is immigration advice.',
      ),
    };
  }
}
