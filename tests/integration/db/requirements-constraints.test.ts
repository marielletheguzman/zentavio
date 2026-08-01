/**
 * What the `requirements` schema refuses.
 *
 * This file exists because of the reason `packages/db/README.md` gives for not writing migrations
 * blind: **a CHECK constraint that parses but does not reject is invisible on review.** Every
 * constraint here is verified by attempting to violate it and asserting on the constraint's name —
 * not merely that something threw.
 *
 * Each test breaks exactly one field of an otherwise valid row, so a failure names the rule.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { expectViolation, migratedTestPool } from './database.ts';
import { PATHWAY_ID, insertPathway, insertRequirement, newId, validRequirement } from './fixtures.ts';

let pool: Pool;

beforeAll(async () => {
  pool = await migratedTestPool();
});

beforeEach(async () => {
  await pool.query('DELETE FROM requirements');
  await pool.query('DELETE FROM immigration_pathways');
  await insertPathway(pool);
});

afterAll(async () => {
  await pool?.end();
});

describe('the fixture itself', () => {
  it('is accepted, so a rejection below is caused by the field under test', async () => {
    await expect(insertRequirement(pool, validRequirement())).resolves.toBeUndefined();
  });
});

describe('ck_req__tier_one', () => {
  it('rejects any source tier but 1, in every domain', async () => {
    for (const tier of [0, 2, 3, 4]) {
      const violation = await expectViolation(pool, () =>
        insertRequirement(pool, validRequirement({ source_tier: tier })),
      );
      expect(violation.constraint).toBe('ck_req__tier_one');
    }
  });

  it('rejects a tier-2 recognition rule — the rule is not immigration-only', async () => {
    const violation = await expectViolation(pool, () =>
      insertRequirement(
        pool,
        validRequirement({
          domain: 'recognition',
          pathway_id: null,
          profession: 'registered-nurse',
          source_tier: 2,
        }),
      ),
    );
    expect(violation.constraint).toBe('ck_req__tier_one');
  });
});

describe('ck_req__scope', () => {
  it('rejects an immigration requirement with no pathway', async () => {
    const violation = await expectViolation(pool, () =>
      insertRequirement(pool, validRequirement({ domain: 'immigration', pathway_id: null })),
    );
    expect(violation.constraint).toBe('ck_req__scope');
  });

  it('rejects a recognition requirement with no profession', async () => {
    const violation = await expectViolation(pool, () =>
      insertRequirement(
        pool,
        validRequirement({ domain: 'recognition', pathway_id: null, profession: null }),
      ),
    );
    expect(violation.constraint).toBe('ck_req__scope');
  });

  it('rejects a credential requirement with no profession', async () => {
    const violation = await expectViolation(pool, () =>
      insertRequirement(
        pool,
        validRequirement({ domain: 'credential', pathway_id: null, profession: null }),
      ),
    );
    expect(violation.constraint).toBe('ck_req__scope');
  });

  it('accepts a recognition requirement scoped by profession', async () => {
    await expect(
      insertRequirement(
        pool,
        validRequirement({
          domain: 'recognition',
          pathway_id: null,
          profession: 'registered-nurse',
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it.each(['authentication', 'language', 'employment_clearance'])(
    'accepts a %s requirement with neither pathway nor profession',
    async (domain) => {
      await expect(
        insertRequirement(
          pool,
          validRequirement({ domain, pathway_id: null, profession: null }),
        ),
      ).resolves.toBeUndefined();
    },
  );
});

describe('the closed-set constraints', () => {
  it('rejects a domain outside the six', async () => {
    const violation = await expectViolation(pool, () =>
      insertRequirement(pool, validRequirement({ domain: 'visa' })),
    );
    expect(violation.constraint).toBe('ck_req__domain');
  });

  it('rejects an imposed_by outside the three', async () => {
    const violation = await expectViolation(pool, () =>
      insertRequirement(pool, validRequirement({ imposed_by: 'employer' })),
    );
    expect(violation.constraint).toBe('ck_req__imposed_by');
  });

  it('rejects a kind outside the eight', async () => {
    const violation = await expectViolation(pool, () =>
      insertRequirement(pool, validRequirement({ kind: 'suggestion' })),
    );
    expect(violation.constraint).toBe('ck_req__kind');
  });

  it('rejects an evaluation outside the six', async () => {
    const violation = await expectViolation(pool, () =>
      insertRequirement(pool, validRequirement({ evaluation: 'llm' })),
    );
    expect(violation.constraint).toBe('ck_req__evaluation');
  });
});

describe('ck_req__validity', () => {
  it('rejects a validity window that ends before it starts', async () => {
    const violation = await expectViolation(pool, () =>
      insertRequirement(
        pool,
        validRequirement({ effective_from: '2026-06-01', effective_to: '2026-01-01' }),
      ),
    );
    expect(violation.constraint).toBe('ck_req__validity');
  });

  it('accepts a window that ends on the day it starts', async () => {
    await expect(
      insertRequirement(
        pool,
        validRequirement({ effective_from: '2026-01-01', effective_to: '2026-01-01' }),
      ),
    ).resolves.toBeUndefined();
  });
});

describe('ck_req__contested_note', () => {
  it('rejects a contested row with no note — ambiguity is written down, never resolved silently', async () => {
    const violation = await expectViolation(pool, () =>
      insertRequirement(pool, validRequirement({ contested: true, contested_note: null })),
    );
    expect(violation.constraint).toBe('ck_req__contested_note');
  });

  it('accepts a contested row that explains the ambiguity', async () => {
    await expect(
      insertRequirement(
        pool,
        validRequirement({ contested: true, contested_note: 'Two official pages disagree.' }),
      ),
    ).resolves.toBeUndefined();
  });
});

describe('uq_req__current', () => {
  it('rejects a second live version of the same requirement', async () => {
    const first = validRequirement({ requirement_id: 'de.eu-blue-card.threshold' });
    await insertRequirement(pool, first);

    const violation = await expectViolation(pool, () =>
      insertRequirement(
        pool,
        validRequirement({ requirement_id: 'de.eu-blue-card.threshold', version: '2026.2' }),
      ),
    );
    expect(violation.constraint).toBe('uq_req__current');
  });

  it('accepts a new live version once the previous one is closed', async () => {
    const first = validRequirement({
      requirement_id: 'de.eu-blue-card.threshold',
      version: '2025.1',
      effective_from: '2025-01-01',
      effective_to: '2025-12-31',
    });
    await insertRequirement(pool, first);

    await expect(
      insertRequirement(
        pool,
        validRequirement({
          requirement_id: 'de.eu-blue-card.threshold',
          version: '2026.1',
          effective_from: '2026-01-01',
        }),
      ),
    ).resolves.toBeUndefined();
  });
});

describe('uq_req__id_version', () => {
  it('rejects the same version of a requirement twice, even when superseded', async () => {
    await insertRequirement(
      pool,
      validRequirement({
        requirement_id: 'de.eu-blue-card.threshold',
        version: '2025.1',
        effective_from: '2025-01-01',
        effective_to: '2025-12-31',
      }),
    );

    const violation = await expectViolation(pool, () =>
      insertRequirement(
        pool,
        validRequirement({
          requirement_id: 'de.eu-blue-card.threshold',
          version: '2025.1',
          effective_from: '2025-01-01',
          effective_to: '2025-06-30',
        }),
      ),
    );
    expect(violation.constraint).toBe('uq_req__id_version');
  });
});

describe('the foreign keys', () => {
  it('rejects a pathway that does not exist', async () => {
    const violation = await expectViolation(pool, () =>
      insertRequirement(pool, validRequirement({ pathway_id: 'de.does-not-exist' })),
    );
    expect(violation.constraint).toBe('fk_req__pathways');
  });

  it('refuses to delete a pathway a requirement still points at', async () => {
    await insertRequirement(pool, validRequirement());
    const violation = await expectViolation(pool, () =>
      pool.query('DELETE FROM immigration_pathways WHERE pathway_id = $1', [PATHWAY_ID]),
    );
    expect(violation.constraint).toBe('fk_req__pathways');
  });

  it('rejects a supersedes pointing at no requirement', async () => {
    const violation = await expectViolation(pool, () =>
      insertRequirement(pool, validRequirement({ ...{}, id: newId() })).then(() =>
        pool.query('UPDATE requirements SET supersedes = $1', [newId()]),
      ),
    );
    expect(violation.constraint).toBe('fk_req__supersedes');
  });
});

describe('ck_ip__sources', () => {
  it('rejects a pathway with no official source', async () => {
    const violation = await expectViolation(pool, () =>
      pool.query(
        `INSERT INTO immigration_pathways (id, pathway_id, jurisdiction, name, official_sources)
         VALUES ($1, 'de.no-sources', 'DE', 'Unsourced', '[]'::jsonb)`,
        [newId()],
      ),
    );
    expect(violation.constraint).toBe('ck_ip__sources');
  });
});
