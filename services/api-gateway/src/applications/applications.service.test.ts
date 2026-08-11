/**
 * What this service decides, as opposed to what it orchestrates.
 *
 * One decision, and it is the whole of ADR-0019: **the prediction is captured when the person
 * acts, not when the result arrives.** A score recorded late is a score that has already moved,
 * which calibrates nothing. Everything else here is a pass-through the integration suite covers
 * against a real database.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Kysely } from 'kysely';
import type { Database } from '@zentavio/db';
import type { GapResponseWire } from '@zentavio/types';

import { ApplicationsService } from './applications.service.ts';
import type { GapOutcomeForUser, GapService } from '../gap/gap.service.ts';

const gap = (readiness: Partial<GapResponseWire['readiness']>): GapResponseWire =>
  ({
    status: 'ok',
    scorer_version: 'skill-gap@1.0.0',
    knowledge_as_of: '2026-06-01T00:00:00.000Z',
    readiness: { status: 'ok', score: 0.1523, ...readiness },
  }) as unknown as GapResponseWire;

function stubGap(outcome: GapOutcomeForUser): GapService {
  return { currentGap: vi.fn(async () => outcome) } as unknown as GapService;
}

function service(outcome: GapOutcomeForUser) {
  return new ApplicationsService({} as unknown as Kysely<Database>, stubGap(outcome));
}

/** Reach the private capture through the public path, without a database. */
async function predictionFor(outcome: GapOutcomeForUser) {
  const captured: unknown[] = [];
  const subject = service(outcome);

  vi.spyOn(await import('@zentavio/db'), 'recordApplication').mockImplementation(
    async (_db, options) => {
      captured.push(options.prediction);
      return { id: 'a' } as never;
    },
  );

  await subject.record('user-1', { externalRole: 'Backend Engineer' });
  return captured[0];
}

describe('the prediction is captured at the moment of recording', () => {
  it('stores the readiness score and the scorer that produced it', async () => {
    // Both or neither: `ck_applications__predicted` refuses a score with no scorer, because a
    // number nobody can attribute to a version of the code cannot be checked later.
    expect(await predictionFor({ kind: 'computed', gap: gap({}) })).toEqual({
      score: 0.1523,
      scorerVersion: 'skill-gap@1.0.0',
      knowledgeAsOf: new Date('2026-06-01T00:00:00.000Z'),
    });
  });

  it('records no prediction when the person has no profile or target', async () => {
    // A zero here would be a prediction nobody made. The honest row is one that cannot calibrate.
    expect(await predictionFor({ kind: 'no-profile' })).toBeNull();
    expect(await predictionFor({ kind: 'no-target' })).toBeNull();
  });

  it('records no prediction when readiness itself is unknown', async () => {
    // A profile too sparse to score returns `unknown` rather than a low number — M1c's refusal,
    // and it has to survive into this table or the refusal was pointless.
    expect(
      await predictionFor({
        kind: 'computed',
        gap: gap({ status: 'unknown', score: null }),
      }),
    ).toBeNull();
  });

  it('does not block recording when the scoring service is down', async () => {
    // Somebody recording what they did must not be stopped because a service is unavailable. The
    // consequence is an uncalibratable row, which is strictly better than a lost one.
    expect(await predictionFor({ kind: 'unavailable', reason: 'timed out' })).toBeNull();
  });
});
