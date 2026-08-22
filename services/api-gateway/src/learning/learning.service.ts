/**
 * The learning catalogue, and what a person says they finished.
 *
 * ## The one thing this service must not do
 *
 * **Promote anything.** A completion is a claim about a resource; `evidenced` is a claim about a
 * person's competence, and only a passed assessment may make the second (ADR-0030). Nothing here
 * imports the promotion writer, and `learning-constraints.test.ts` pins that recording a completion
 * leaves `profile_skills` untouched.
 *
 * The surface says so out loud, because a person who thinks finishing a course raised their
 * readiness will optimise for finishing courses — which is the failure M6 exists to prevent.
 */

import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import {
  CompletionInvariantError,
  completionsForUser,
  recordCompletion,
  resourcesForSkill,
  uuidv7,
  type Database,
} from '@zentavio/db';

import { DATABASE } from '../tokens.ts';

export interface ResourceWire {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly format: string;
  readonly costBand: string;
  readonly coverage: string;
  readonly completedAt: string | null;
}

export type RecordOutcome =
  | { readonly kind: 'recorded'; readonly resourceId: string; readonly completedAt: string }
  | { readonly kind: 'refused'; readonly reason: string };

@Injectable()
export class LearningService {
  readonly #db: Kysely<Database>;

  constructor(@Inject(DATABASE) db: Kysely<Database>) {
    this.#db = db;
  }

  /** What is worth reading for a skill, with whatever this person has already marked finished. */
  async catalogue(userId: string, skillSlug: string): Promise<readonly ResourceWire[]> {
    const skill = await this.#db
      .selectFrom('skills')
      .select('id')
      .where('slug', '=', skillSlug)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();

    if (skill === undefined) return [];

    const [resources, completions] = await Promise.all([
      resourcesForSkill(this.#db, skill.id).execute(),
      completionsForUser(this.#db, userId).execute(),
    ]);

    const finished = new Map(
      completions.map((row) => [row.resource_id, new Date(row.completed_at).toISOString()]),
    );

    return resources.map((row) => ({
      id: row.id,
      title: row.title,
      url: row.url,
      format: row.format,
      costBand: row.cost_band,
      coverage: row.coverage,
      // **`grants_evidence` is deliberately not carried.** Reading it here would be the first step
      // of the decision ADR-0030 defers, and the surface has no use for it: nothing may promote
      // except a passed assessment, so a resource's flag changes nothing anybody sees.
      completedAt: finished.get(row.id) ?? null,
    }));
  }

  /**
   * Record a completion.
   *
   * Returns the row and nothing else — **no skill is promoted and no readiness changes**. That is
   * not an omission to be filled in later here: promotion needs a passed assessment.
   */
  async record(
    userId: string,
    input: { readonly resourceId: string; readonly completedAt: string },
  ): Promise<RecordOutcome> {
    try {
      const row = await recordCompletion(this.#db, {
        userId,
        resourceId: input.resourceId,
        completedAt: input.completedAt,
        newId: uuidv7,
      });

      return {
        kind: 'recorded',
        resourceId: row.resource_id,
        completedAt: new Date(row.completed_at).toISOString(),
      };
    } catch (error) {
      if (error instanceof CompletionInvariantError) {
        return { kind: 'refused', reason: error.message };
      }
      throw error;
    }
  }
}
