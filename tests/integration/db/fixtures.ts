/**
 * Rows for the schema tests.
 *
 * Deliberately inserted with raw SQL rather than through `packages/db`'s repository. These tests
 * establish what *the database* enforces; routing them through the repository's own guards would
 * mean a passing suite could not distinguish "the constraint rejected it" from "TypeScript did".
 *
 * Every value here is a placeholder and is never a real requirement. Real rows come from their
 * authority, dated (`docs/database/entities/requirement.md`).
 */

import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

export const PATHWAY_ID = 'de.eu-blue-card';

/**
 * `randomUUID` is v4, while the schema documents UUIDv7. The column is `uuid` and does not care;
 * the ordering benefit of v7 is a property of the generator, and no generator exists in
 * `packages/db` yet. That gap is real and tracked — it is not what these tests are about.
 */
export function newId(): string {
  return randomUUID();
}

export async function insertPathway(pool: Pool, pathwayId: string = PATHWAY_ID): Promise<string> {
  const id = newId();
  await pool.query(
    `INSERT INTO immigration_pathways (id, pathway_id, jurisdiction, name, official_sources)
     VALUES ($1, $2, 'DE', 'EU Blue Card', $3::jsonb)`,
    [id, pathwayId, JSON.stringify([{ url: 'https://example.invalid/', authoritative_for: 'all' }])],
  );
  return id;
}

export interface RequirementRow {
  id: string;
  requirement_id: string;
  domain: string;
  imposed_by: string;
  jurisdiction: string;
  pathway_id: string | null;
  profession: string | null;
  kind: string;
  value: unknown;
  evaluation: string;
  source_tier: number;
  source_url: string;
  retrieved_at: string;
  authority: string;
  effective_from: string;
  effective_to: string | null;
  version: string;
  contested: boolean;
  contested_note: string | null;
  refresh_after: string;
}

/** A row that satisfies every constraint, so a test can break exactly one thing. */
export function validRequirement(overrides: Partial<RequirementRow> = {}): RequirementRow {
  return {
    id: newId(),
    requirement_id: `de.eu-blue-card.placeholder.${newId().slice(0, 8)}`,
    domain: 'immigration',
    imposed_by: 'destination',
    jurisdiction: 'DE',
    pathway_id: PATHWAY_ID,
    profession: null,
    kind: 'threshold',
    value: { placeholder: true },
    evaluation: 'numeric-gte',
    source_tier: 1,
    source_url: 'https://example.invalid/rule',
    retrieved_at: '2026-07-29T00:00:00Z',
    authority: 'Placeholder Authority',
    effective_from: '2026-01-01',
    effective_to: null,
    version: '2026.1',
    contested: false,
    contested_note: null,
    refresh_after: '2027-01-01',
    ...overrides,
  };
}

export async function insertRequirement(pool: Pool, row: RequirementRow): Promise<void> {
  await pool.query(
    `INSERT INTO requirements (
       id, requirement_id, domain, imposed_by, jurisdiction, pathway_id, profession,
       kind, value, evaluation, source_tier, source_url, retrieved_at, authority,
       effective_from, effective_to, version, contested, contested_note, refresh_after
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8, $9::jsonb, $10, $11, $12, $13, $14,
       $15, $16, $17, $18, $19, $20
     )`,
    [
      row.id,
      row.requirement_id,
      row.domain,
      row.imposed_by,
      row.jurisdiction,
      row.pathway_id,
      row.profession,
      row.kind,
      JSON.stringify(row.value),
      row.evaluation,
      row.source_tier,
      row.source_url,
      row.retrieved_at,
      row.authority,
      row.effective_from,
      row.effective_to,
      row.version,
      row.contested,
      row.contested_note,
      row.refresh_after,
    ],
  );
}
