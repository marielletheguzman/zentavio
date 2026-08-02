/**
 * What each failure means to a person.
 *
 * The orchestration is uninteresting; the taxonomy is the whole point. "You have not chosen a
 * target", "you have no profile yet", and "the service is down" are three different sentences, and
 * collapsing them into one error is how a product stops being usable.
 *
 * The database is faked at the repository boundary rather than mocked query by query — these tests
 * are about the decisions, and a query-shaped mock would assert Kysely's API instead.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GapResponseWire } from '@zentavio/types';
import { GapService } from './gap.service.ts';
import type { GapClient, GapOutcome } from './gap-client.ts';

const repositories = vi.hoisted(() => ({
  primaryTarget: vi.fn(),
  careerRequirements: vi.fn(),
  skillGraph: vi.fn(),
  heldSkills: vi.fn(),
  careerBySlug: vi.fn(),
  setTarget: vi.fn(),
}));

vi.mock('@zentavio/db', () => repositories);

const GAP: GapResponseWire = {
  status: 'ok',
  target_id: 'cloud-platform-engineer',
  target_kind: 'career',
  items: [
    {
      skill_id: 'kubernetes',
      weight: 0.95,
      cluster: 'core',
      position: 1,
      partial: null,
      partial_from: null,
      prerequisites: [],
      basis: 'curated',
      support: null,
    },
  ],
  held: [{ skill_id: 'docker', status: 'evidenced' }],
  confidence: 'high',
  missing: [],
  unweighted: [],
  reason: null,
  scorer_version: 'skill-gap/2026-08-03',
  knowledge_as_of: '2026-08-03T00:00:00Z',
};

function client(outcome: GapOutcome): GapClient {
  return { compute: vi.fn().mockResolvedValue(outcome) } as unknown as GapClient;
}

function service(outcome: GapOutcome = { kind: 'computed', response: GAP }): {
  readonly service: GapService;
  readonly gapClient: GapClient;
} {
  const gapClient = client(outcome);
  const db = {
    selectFrom: () => ({
      select: () => ({
        where: () => ({ executeTakeFirst: async () => ({ slug: 'cloud-platform-engineer' }) }),
      }),
    }),
  };
  return { service: new GapService(db as never, gapClient), gapClient };
}

beforeEach(() => {
  vi.clearAllMocks();
  repositories.primaryTarget.mockResolvedValue({
    career_id: 'career-uuid',
    market_scope: null,
    rank: 1,
  });
  repositories.careerRequirements.mockResolvedValue([
    { skillId: 'kubernetes', weight: 0.95, cluster: 'core', marketScope: null, basis: 'curated', support: null },
  ]);
  repositories.skillGraph.mockResolvedValue([]);
  repositories.heldSkills.mockResolvedValue([
    { skillId: 'docker', status: 'evidenced', confidence: 'high' },
  ]);
});

describe('currentGap', () => {
  it('returns the computed gap', async () => {
    const { service: subject } = service();
    const outcome = await subject.currentGap('user-1');
    expect(outcome).toEqual({ kind: 'computed', gap: GAP });
  });

  it('distinguishes "no target chosen" from an empty gap', async () => {
    // A person who has not answered the question yet gets a prompt, not an error and not a list.
    repositories.primaryTarget.mockResolvedValue(undefined);
    const { service: subject, gapClient } = service();

    expect(await subject.currentGap('user-1')).toEqual({ kind: 'no-target' });
    expect(gapClient.compute).not.toHaveBeenCalled();
  });

  it('distinguishes "no profile" from a gap containing everything', async () => {
    // Every requirement would read as missing, which is technically true and useless. The honest
    // answer is "upload a résumé first".
    repositories.heldSkills.mockResolvedValue([]);
    const { service: subject, gapClient } = service();

    expect(await subject.currentGap('user-1')).toEqual({ kind: 'no-profile' });
    expect(gapClient.compute).not.toHaveBeenCalled();
  });

  it('reports an unreachable service as unavailable rather than as an empty gap', async () => {
    const { service: subject } = service({
      kind: 'unavailable',
      reason: 'timed out',
      retryable: true,
    });
    expect(await subject.currentGap('user-1')).toEqual({
      kind: 'unavailable',
      reason: 'timed out',
    });
  });

  it('treats a rejected request as our defect, not the user’s', async () => {
    // The gateway built the request. If the service refuses it, blaming the caller would send
    // someone chasing a problem they cannot fix.
    const { service: subject } = service({
      kind: 'rejected',
      code: 'VALIDATION_FAILED',
      message: 'bad request',
      correlationId: 'abc',
    });
    const outcome = await subject.currentGap('user-1');
    expect(outcome.kind).toBe('unavailable');
  });

  it('passes the target’s market through, because it decides the requirement set', async () => {
    repositories.primaryTarget.mockResolvedValue({
      career_id: 'career-uuid',
      market_scope: 'DE',
      rank: 1,
    });
    const { service: subject, gapClient } = service();
    await subject.currentGap('user-1');

    const request = vi.mocked(gapClient.compute).mock.calls[0]?.[0];
    expect(request?.market).toBe('DE');
  });

  it('records when the knowledge was read, so the gap stays reproducible', async () => {
    const { service: subject, gapClient } = service();
    await subject.currentGap('user-1');

    const request = vi.mocked(gapClient.compute).mock.calls[0]?.[0];
    expect(request?.knowledge_as_of).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('sends slugs rather than database ids', async () => {
    // The AI layer speaks slugs — the parser's closed set, the prompts, the gap's items. Handing
    // it uuids would make every response unreadable.
    const { service: subject, gapClient } = service();
    await subject.currentGap('user-1');

    const request = vi.mocked(gapClient.compute).mock.calls[0]?.[0];
    expect(request?.requirements[0]?.skill_id).toBe('kubernetes');
    expect(request?.held[0]?.skill_id).toBe('docker');
    expect(request?.target_id).toBe('cloud-platform-engineer');
  });
});

describe('chooseTarget', () => {
  it('resolves a slug and records the target', async () => {
    repositories.careerBySlug.mockResolvedValue({ id: 'career-uuid', slug: 'cloud-platform-engineer' });
    repositories.setTarget.mockResolvedValue({ rank: 1 });
    const { service: subject } = service();

    expect(await subject.chooseTarget('user-1', 'cloud-platform-engineer', 'DE')).toEqual({
      kind: 'set',
      careerSlug: 'cloud-platform-engineer',
      rank: 1,
    });
  });

  it('reports an unknown slug rather than letting a foreign key fail', async () => {
    // An unknown slug is a 400 naming it, not a 500 from a constraint violation three layers down.
    repositories.careerBySlug.mockResolvedValue(undefined);
    const { service: subject } = service();

    expect(await subject.chooseTarget('user-1', 'not-a-track', null)).toEqual({
      kind: 'unknown-career',
      slug: 'not-a-track',
    });
    expect(repositories.setTarget).not.toHaveBeenCalled();
  });
});
