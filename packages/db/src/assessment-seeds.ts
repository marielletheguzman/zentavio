/**
 * Loading authored assessments (ADR-0030).
 *
 * An instrument is **curated content**, the same standing as the skill graph: written by us, tier 3,
 * and replaced by editing the file rather than by a migration. It is not reference data like a fact
 * kind — a fact kind is the shape of a question, and this is the question.
 *
 * ## What validation is for here
 *
 * A badly authored item produces a confidently wrong `evidenced`, in the direction that flatters.
 * Most of that risk is judgement and cannot be checked by code. What *can* be checked is whether an
 * item is capable of supporting a claim at all: it names what it evidences, it cites where its
 * answer comes from, and its key is among the options a person is actually offered. Those are
 * checked before anything is written, because an instrument published with a broken item scores
 * everybody against a question nobody can answer.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool } from 'pg';

import { uuidv7 } from './uuid.ts';

export interface AssessmentItemSeed {
  readonly position: number;
  readonly stem: string;
  readonly options: readonly { readonly key: string; readonly text: string }[];
  readonly correctOption: string;
  /** The narrow capability this item supports, in the words a surface will use. */
  readonly evidences: string;
  /** Official documentation the correct answer follows from. */
  readonly sourceUrl: string;
}

export interface AssessmentSeedFile {
  readonly assessment: {
    readonly slug: string;
    readonly version: number;
    readonly skillSlug: string;
    readonly title: string;
    readonly description?: string | null;
    readonly itemCount: number;
    readonly passThreshold: number;
    /** What passing deliberately does not show. Required — publishing without it overclaims. */
    readonly doesNotEvidence: string;
  };
  readonly items: readonly AssessmentItemSeed[];
}

export interface NamedAssessmentSeed {
  readonly name: string;
  readonly seed: AssessmentSeedFile;
}

/** Every authored instrument, in a stable order. Absent directory means none, which is not an error. */
export async function loadAssessmentSeeds(directory: string): Promise<readonly NamedAssessmentSeed[]> {
  let names: string[];
  try {
    names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
  } catch {
    return [];
  }

  const seeds: NamedAssessmentSeed[] = [];
  for (const name of names) {
    seeds.push({
      name,
      seed: JSON.parse(await readFile(join(directory, name), 'utf8')) as AssessmentSeedFile,
    });
  }
  return seeds;
}

/** Everything wrong with an instrument, rather than the first thing. */
export function validateAssessmentSeed(seed: AssessmentSeedFile): readonly string[] {
  const problems: string[] = [];
  const { assessment, items } = seed;

  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(assessment.slug)) {
    problems.push(`slug is not kebab-case: ${assessment.slug}`);
  }
  if (assessment.version < 1) problems.push('version must be at least 1');

  if (assessment.doesNotEvidence.trim().length < 40) {
    // A one-line disclaimer is the field being filled in rather than used. The negative claim is the
    // half a reader most needs, and it takes a sentence or two to state honestly.
    problems.push('doesNotEvidence must actually say what passing does not show');
  }

  if (items.length !== assessment.itemCount) {
    problems.push(`itemCount says ${String(assessment.itemCount)} and there are ${String(items.length)} items`);
  }
  if (assessment.passThreshold < 1 || assessment.passThreshold > assessment.itemCount) {
    problems.push(
      `passThreshold ${String(assessment.passThreshold)} is outside 1..${String(assessment.itemCount)}`,
    );
  }

  const positions = new Set<number>();
  for (const item of items) {
    const at = `item ${String(item.position)}`;

    if (positions.has(item.position)) problems.push(`duplicate position: ${String(item.position)}`);
    positions.add(item.position);

    if (item.options.length < 2) problems.push(`${at}: an item needs at least two options`);

    const keys = item.options.map((option) => option.key);
    if (new Set(keys).size !== keys.length) problems.push(`${at}: duplicate option keys`);

    // The failure this catches is silent and total: every attempt at the item is wrong, the pass
    // rate drops, and nothing anywhere reports a fault.
    if (!keys.includes(item.correctOption)) {
      problems.push(`${at}: the correct option '${item.correctOption}' is not among the options offered`);
    }

    if (item.evidences.trim().length < 20) {
      problems.push(`${at}: evidences must state the capability this item supports`);
    }
    if (!item.sourceUrl.startsWith('https://')) {
      problems.push(`${at}: sourceUrl must be an official documentation URL`);
    }
  }

  return problems;
}

export interface AssessmentSeedPlan {
  readonly assessmentsWritten: number;
  readonly itemsWritten: number;
}

/**
 * Write one instrument and its items, published.
 *
 * **Rewrites the version in place.** Editing an authored file and re-seeding replaces that version's
 * items — which is right while a version is being written and wrong once anybody has passed it, so
 * a change that alters what the instrument asks is a **new version**, not an edit. Nothing here
 * enforces that: it is a judgement about whether the questions changed, and the cost of getting it
 * wrong is a pass citing a version that no longer asks what it asked.
 */
export async function applyAssessmentSeed(
  pool: Pool,
  seed: AssessmentSeedFile,
): Promise<AssessmentSeedPlan> {
  const { assessment, items } = seed;

  const { rows: skills } = await pool.query<{ id: string }>(
    'SELECT id FROM skills WHERE slug = $1 AND deleted_at IS NULL',
    [assessment.skillSlug],
  );
  const skillId = skills[0]?.id;
  if (skillId === undefined) {
    throw new Error(
      `assessment ${assessment.slug}: no skill '${assessment.skillSlug}' — an instrument must ` +
        'evidence a skill the closed set actually contains',
    );
  }

  const { rows: existing } = await pool.query<{ id: string }>(
    'SELECT id FROM skill_assessments WHERE slug = $1 AND version = $2',
    [assessment.slug, assessment.version],
  );

  const id = existing[0]?.id ?? uuidv7();

  if (existing[0] === undefined) {
    await pool.query(
      `INSERT INTO skill_assessments
         (id, slug, version, skill_id, title, description, item_count, pass_threshold,
          status, published_at, does_not_evidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'published',now(),$9)`,
      [
        id,
        assessment.slug,
        assessment.version,
        skillId,
        assessment.title,
        assessment.description ?? null,
        assessment.itemCount,
        assessment.passThreshold,
        assessment.doesNotEvidence,
      ],
    );
  } else {
    await pool.query(
      `UPDATE skill_assessments
          SET title = $2, description = $3, item_count = $4, pass_threshold = $5,
              does_not_evidence = $6, updated_at = now()
        WHERE id = $1`,
      [
        id,
        assessment.title,
        assessment.description ?? null,
        assessment.itemCount,
        assessment.passThreshold,
        assessment.doesNotEvidence,
      ],
    );
    await pool.query('DELETE FROM assessment_items WHERE assessment_id = $1', [id]);
  }

  for (const item of items) {
    await pool.query(
      `INSERT INTO assessment_items
         (id, assessment_id, position, stem, options, correct_option, evidences, source_url)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,
      [
        uuidv7(),
        id,
        item.position,
        item.stem,
        JSON.stringify(item.options),
        item.correctOption,
        item.evidences,
        item.sourceUrl,
      ],
    );
  }

  return { assessmentsWritten: 1, itemsWritten: items.length };
}
