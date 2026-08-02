/**
 * Gathering everything a gap needs, and deciding what each failure means to a person.
 *
 * The interesting work here is not the orchestration — it is the taxonomy. Four things can go
 * wrong before a gap exists, and they are four different sentences to a user:
 *
 * * they have not chosen a target
 * * they have no parsed profile yet
 * * the track exists but nobody has modelled its requirements
 * * the gap service is down
 *
 * Collapsing any of these into "something went wrong" is how a product stops being usable, so each
 * is its own outcome and the controller maps it to its own status.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Kysely } from 'kysely';
import {
  careerBySlug,
  careerRequirements,
  heldSkills,
  primaryTarget,
  setTarget,
  skillGraph,
  type Database,
} from '@zentavio/db';
import type { GapRequestWire, GapResponseWire } from '@zentavio/types';
import type { GapClient } from './gap-client.ts';
import { DATABASE, GAP_CLIENT } from '../tokens.ts';

export type GapOutcomeForUser =
  | { readonly kind: 'computed'; readonly gap: GapResponseWire }
  | { readonly kind: 'no-target' }
  | { readonly kind: 'no-profile' }
  | { readonly kind: 'unavailable'; readonly reason: string };

export type SetTargetOutcome =
  | { readonly kind: 'set'; readonly careerSlug: string; readonly rank: number }
  | { readonly kind: 'unknown-career'; readonly slug: string };

@Injectable()
export class GapService {
  readonly #db: Kysely<Database>;
  readonly #client: GapClient;
  readonly #logger = new Logger(GapService.name);

  constructor(@Inject(DATABASE) db: Kysely<Database>, @Inject(GAP_CLIENT) client: GapClient) {
    this.#db = db;
    this.#client = client;
  }

  /**
   * Record the track a person is pursuing.
   *
   * Keyed by **slug**, never by database id: the browser has no business holding uuids, and an
   * unknown slug becomes a named 400 rather than a foreign key violation surfacing as a 500. Same
   * reasoning as the correction route.
   */
  async chooseTarget(
    userId: string,
    careerSlug: string,
    marketScope: string | null,
  ): Promise<SetTargetOutcome> {
    const career = await careerBySlug(this.#db, careerSlug);
    if (career === undefined) {
      return { kind: 'unknown-career', slug: careerSlug };
    }

    const target = await setTarget(this.#db, {
      userId,
      careerId: career.id,
      marketScope,
    });

    return { kind: 'set', careerSlug: career.slug, rank: target.rank };
  }

  /**
   * Compute the gap between the person's current profile and their target.
   *
   * Reads are issued together because they are independent and each is a round trip; the gap cannot
   * start until all of them land anyway.
   */
  async currentGap(userId: string): Promise<GapOutcomeForUser> {
    const target = await primaryTarget(this.#db, userId);
    if (target === undefined) {
      return { kind: 'no-target' };
    }

    const [requirements, edges, held] = await Promise.all([
      careerRequirements(this.#db, target.career_id),
      skillGraph(this.#db),
      heldSkills(this.#db, userId),
    ]);

    if (held.length === 0) {
      // Distinct from an empty gap. Every requirement would read as missing, which is technically
      // true and useless: the honest answer is "upload a résumé first", not a list of 30 gaps.
      return { kind: 'no-profile' };
    }

    const career = await this.#db
      .selectFrom('careers')
      .select('slug')
      .where('id', '=', target.career_id)
      .executeTakeFirst();

    const request: GapRequestWire = {
      target_id: career?.slug ?? target.career_id,
      target_kind: 'career',
      requirements: requirements.map((row) => ({
        skill_id: row.skillId,
        weight: row.weight,
        cluster: row.cluster as GapRequestWire['requirements'][number]['cluster'],
        market_scope: row.marketScope,
        basis: row.basis,
        support: row.support,
      })),
      held: held.map((row) => ({
        skill_id: row.skillId,
        status: row.status as 'evidenced' | 'claimed',
        confidence: row.confidence as 'high' | 'medium' | 'low',
      })),
      edges: edges.map((row) => ({
        from_skill_id: row.fromSkillId,
        to_skill_id: row.toSkillId,
        edge_type: row.edgeType,
        weight: row.weight,
        source_url: row.sourceUrl,
        source_tier: row.sourceTier,
      })),
      market: target.market_scope,
      // The gap is computed against knowledge as it is right now. Recording the moment makes the
      // result reproducible later, when the graph has moved on.
      knowledge_as_of: new Date().toISOString(),
      unresolved: [],
    };

    const outcome = await this.#client.compute(request);

    if (outcome.kind === 'computed') {
      return { kind: 'computed', gap: outcome.response };
    }

    if (outcome.kind === 'rejected') {
      // The gateway built a request the service refused. That is a defect here, not a user error,
      // so it is logged loudly and reported as unavailable rather than blamed on the caller.
      this.#logger.error(
        `skill-gap rejected the request: ${outcome.code} (${outcome.correlationId})`,
      );
      return { kind: 'unavailable', reason: 'the gap service refused the request' };
    }

    this.#logger.warn(`skill-gap unavailable: ${outcome.reason}`);
    return { kind: 'unavailable', reason: outcome.reason };
  }
}
