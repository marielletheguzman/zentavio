/**
 * Preparation built from what a role actually requires, with no company in it.
 *
 * ## Why this is the important half of M8, not the fallback
 *
 * ADR-0031's floors mean almost every `(company, role_family)` pairing shows a shortfall for a long
 * time, and this is what a person gets instead. It is the path most people will take, so it gets the
 * care usually spent on the rare one.
 *
 * ## What it refuses to do
 *
 * **No questions.** `docs/features/interview-prep.md` is explicit that generated questions are
 * labelled as generated and never attributed to a company, and generating them at all belongs to
 * `ai/interview-prep`, which does not exist. Themes with their basis are honest; a question invented
 * here and shown beside a company's name is the fabrication this milestone is written against.
 *
 * **No company.** Nothing in this module reads a company, a report or a pairing. The whole point is
 * that it says the same thing whether five people reported that employer or nobody has.
 *
 * **No invented weights.** Every theme carries the weight and cluster stored on `career_skills`,
 * which came from the seeded track at tier 3. A theme this cannot ground is a theme it does not
 * return.
 */

import type { Kysely } from 'kysely';

import type { Database } from '../schema.ts';

export interface PreparationTheme {
  readonly skillId: string;
  readonly slug: string;
  readonly name: string;
  /** Importance for this track, as stored. Shown, never rounded into an adjective. */
  readonly weight: number;
  readonly cluster: string;
  /**
   * Whether the person already evidences this skill.
   *
   * `evidenced` and `claimed` are kept apart rather than collapsed into "you have it", because the
   * distinction is the one that makes readiness honest everywhere else in this product.
   */
  readonly standing: 'evidenced' | 'claimed' | 'missing';
}

export interface RolePreparation {
  readonly careerId: string;
  readonly themes: readonly PreparationTheme[];
  /** How many requirements the track has in total, so a capped list does not read as the whole set. */
  readonly requirementCount: number;
}

/**
 * How many themes to return.
 *
 * **A cap, deliberately.** A track can require thirty skills; thirty themes is a syllabus, not
 * preparation, and somebody reading it before an interview would take nothing from it. The total is
 * returned alongside so the list never pretends to be exhaustive.
 */
export const MAX_THEMES = 8;

/**
 * Preparation for a role, optionally marked with where this person stands.
 *
 * Ordered by the weight the track stores — most important first — and `core` before `supporting`
 * before the rest at equal weight, because a person with limited time should meet the load-bearing
 * requirements first.
 *
 * `profileId` is optional. Without it every theme reads `missing`, which is honest for somebody with
 * no profile: we do not know that they lack these, and we do not claim they have them either.
 */
export async function rolePreparation(
  db: Kysely<Database>,
  options: { readonly careerId: string; readonly profileId?: string },
): Promise<RolePreparation> {
  const requirements = await db
    .selectFrom('career_skills')
    .innerJoin('skills', 'skills.id', 'career_skills.skill_id')
    .select([
      'career_skills.skill_id as skill_id',
      'skills.slug as slug',
      'skills.name as name',
      'career_skills.weight as weight',
      'career_skills.cluster as cluster',
    ])
    .where('career_skills.career_id', '=', options.careerId)
    .where('skills.deleted_at', 'is', null)
    .execute();

  const held =
    options.profileId === undefined
      ? []
      : await db
          .selectFrom('profile_skills')
          .select(['skill_id', 'status'])
          .where('user_profile_id', '=', options.profileId)
          .execute();

  const standingBySkill = new Map(held.map((row) => [row.skill_id, row.status]));

  const clusterOrder: Readonly<Record<string, number>> = {
    core: 0,
    supporting: 1,
    differentiating: 2,
    peripheral: 3,
  };

  const themes = requirements
    .map((requirement) => ({
      skillId: requirement.skill_id,
      slug: requirement.slug,
      name: requirement.name,
      weight: Number(requirement.weight),
      cluster: requirement.cluster,
      standing: (standingBySkill.get(requirement.skill_id) ?? 'missing') as
        | 'evidenced'
        | 'claimed'
        | 'missing',
    }))
    .sort((left, right) => {
      if (right.weight !== left.weight) return right.weight - left.weight;
      return (clusterOrder[left.cluster] ?? 9) - (clusterOrder[right.cluster] ?? 9);
    })
    .slice(0, MAX_THEMES);

  return { careerId: options.careerId, themes, requirementCount: requirements.length };
}
