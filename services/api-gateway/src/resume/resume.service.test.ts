/**
 * The upload use case, against fake ports.
 *
 * The cases worth testing are the ones where "did something get written" is the question. Storing a
 * profile that should not have been stored is the failure with a real cost: it overwrites the one
 * the user already had.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParseResponseWire } from '@zentavio/types';
import type { ParserOutcome } from './parser-client.ts';
import { ResumeService } from './resume.service.ts';

/**
 * Hoisted by vitest above the imports, which is the only placement that works: `vi.doMock` after
 * the module under test has already been imported silently does nothing, and the real
 * `createProfileVersion` runs against a database that is not there. That mistake cost a confusing
 * failure inside Kysely's transaction code, far from its cause.
 */
const created: Array<Record<string, unknown>> = [];

vi.mock('@zentavio/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@zentavio/db')>()),
  createProfileVersion: vi.fn(async (_db: unknown, options: Record<string, unknown>) => {
    created.push(options);
    return { id: 'profile-1', version: 1 };
  }),
}));

beforeEach(() => {
  created.length = 0;
});

/** The two calls the service makes on the parser client, and nothing else. */
function fakeParser(outcome: ParserOutcome) {
  return { parse: vi.fn(async () => outcome) };
}

function parseResponse(overrides: Partial<ParseResponseWire> = {}): ParseResponseWire {
  return {
    status: 'ok',
    skills: [
      {
        slug: 'kubernetes',
        status: 'claimed',
        evidence_kind: null,
        source_span: 'Kubernetes',
        confidence: 'medium',
      },
    ],
    reason: null,
    degraded_sections: [],
    completeness: 0.2,
    parser_version: 'resume-parser/test',
    ...overrides,
  };
}

/**
 * A database stand-in covering only what the service touches: the registry query and the profile
 * write. Deliberately not a mock of Kysely — this asserts the service's behaviour, and the real
 * query is covered by the integration suite against PostgreSQL.
 */
function fakeDb(registry: Array<{ id: string; slug: string }>) {
  return {
    handle: {
      selectFrom: () => ({
        leftJoin: () => ({
          select: () => ({
            where: () => ({
              groupBy: () => ({
                execute: async () =>
                  registry.map((r) => ({ ...r, name: r.slug, kind: 'technology', aliases: [r.slug] })),
              }),
            }),
          }),
        }),
      }),
    },
  };
}

async function runUpload(
  outcome: ParserOutcome,
  registry: Array<{ id: string; slug: string }> = [{ id: '0199-kubernetes', slug: 'kubernetes' }],
) {
  const db = fakeDb(registry);
  const parser = fakeParser(outcome);

  const service = new ResumeService(db.handle as never, parser as never);
  const result = await service.upload({
    userId: 'user-1',
    content: Buffer.from('Skills\nKubernetes'),
    contentType: 'text/plain',
  });

  // `created` is the module-level array the hoisted mock pushes into. An earlier version of this
  // file declared a local `created` here that shadowed it, so every "nothing was stored" assertion
  // checked an array nothing could ever write to — six passing tests proving nothing.
  return { result, created, parser };
}

describe('ResumeService.upload', () => {
  it('passes the closed set to the parser and stores what comes back', async () => {
    const { parser, created, result } = await runUpload({
      kind: 'parsed',
      response: parseResponse(),
    });

    const request = parser.parse.mock.calls[0]?.[0] as { skills: unknown[] };
    expect(request.skills).toHaveLength(1);

    // The positive case, so the "nothing was stored" assertions below mean something: this proves
    // the array they check is one a write actually reaches.
    expect(result.kind).toBe('stored');
    expect(created).toHaveLength(1);
    expect((created[0] as { parserVersion: string }).parserVersion).toBe('resume-parser/test');
  });

  it('does not store an unknown parse', async () => {
    // The failure this prevents: a user uploads a scan by mistake and loses the profile they had.
    const { result, created } = await runUpload({
      kind: 'parsed',
      response: parseResponse({ status: 'unknown', skills: [], reason: 'looks like a scan' }),
    });

    expect(result.kind).toBe('not-stored');
    expect(created).toHaveLength(0);
  });

  it('does not store a parse with no skills, even when the status is ok', async () => {
    const { result, created } = await runUpload({
      kind: 'parsed',
      response: parseResponse({ status: 'partial', skills: [], reason: 'nothing recognised' }),
    });

    expect(result.kind).toBe('not-stored');
    expect(created).toHaveLength(0);
  });

  it('drops a slug the registry does not know rather than failing the whole profile', async () => {
    // Unreachable unless the parser invents a slug, which it is built not to do — but a foreign
    // key violation here would lose every other skill in the upload.
    const { result, created } = await runUpload(
      { kind: 'parsed', response: parseResponse() },
      [{ id: '0199-terraform', slug: 'terraform' }],
    );

    expect(result.kind).toBe('not-stored');
    expect(created).toHaveLength(0);
  });

  it('passes a rejection through without storing', async () => {
    const { result, created } = await runUpload({
      kind: 'rejected',
      code: 'VALIDATION_FAILED',
      message: 'Unsupported content type',
      correlationId: 'abc',
    });

    expect(result.kind).toBe('rejected');
    expect(created).toHaveLength(0);
  });

  it('reports the parser being unreachable as unavailable', async () => {
    const { result, created } = await runUpload({
      kind: 'unavailable',
      reason: 'unreachable',
      retryable: true,
    });

    expect(result.kind).toBe('unavailable');
    expect(created).toHaveLength(0);
  });
});
