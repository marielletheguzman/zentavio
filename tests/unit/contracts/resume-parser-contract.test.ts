/**
 * The TypeScript half of the parser contract.
 *
 * The fixtures under `tests/fixtures/resume-parser/` are written by the **Python service itself**
 * (`ai/resume-parser/tests/test_contract.py`), not by hand. This file validates them against the
 * hand-written types in `@zentavio/types`.
 *
 * So the two languages are pinned to each other: change the response shape in Python and the
 * fixtures change, and these assertions fail. Change the TypeScript type and they fail too. Until
 * schema generation exists — a dependency needing its own ADR — this is the mechanism that keeps
 * `tech-stack.md`'s "neither side hand-writes the other's types" from being aspiration.
 *
 * Lives under `tests/` rather than inside `packages/types` because `package-types` is the innermost
 * layer and may import nothing (`eslint.config.mjs`); a `test` element may import it.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isParseResponse, isServiceError } from '@zentavio/types';

const FIXTURE_DIR = fileURLToPath(new URL('../../fixtures/resume-parser/', import.meta.url));

interface Capture {
  readonly name: string;
  readonly httpStatus: number;
  readonly body: unknown;
}

function load(name: string): Capture {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')) as Capture;
}

const captures = readdirSync(FIXTURE_DIR)
  .filter((name) => name.endsWith('.json'))
  .map(load);

describe('the résumé parser contract', () => {
  it('has fixtures at all', () => {
    // If the generator was never run, every assertion below would vacuously pass over an empty
    // array — the classic way a contract test proves nothing.
    expect(captures.length).toBeGreaterThanOrEqual(4);
  });

  it.each(captures.filter((c) => c.httpStatus === 200).map((c) => [c.name, c] as const))(
    'validates the 200 response for %s',
    (_name, capture) => {
      expect(isParseResponse(capture.body)).toBe(true);
    },
  );

  it.each(captures.filter((c) => c.httpStatus >= 400).map((c) => [c.name, c] as const))(
    'validates the error envelope for %s',
    (_name, capture) => {
      expect(isServiceError(capture.body)).toBe(true);
      expect(isParseResponse(capture.body)).toBe(false);
    },
  );

  it('covers every status a caller must handle', () => {
    // A contract exercised only on the happy path is how `unknown` handling rots unnoticed.
    const statuses = new Set(
      captures
        .filter((c) => c.httpStatus === 200)
        .map((c) => (c.body as { status: string }).status),
    );
    expect(statuses).toEqual(new Set(['ok', 'partial', 'unknown']));
  });

  it('carries a source span on every skill, because a claim must be correctable', () => {
    for (const capture of captures.filter((c) => c.httpStatus === 200)) {
      const body = capture.body as { skills: { source_span: string }[] };
      for (const skill of body.skills) {
        expect(skill.source_span.length).toBeGreaterThan(0);
      }
    }
  });

  it('never reports an evidenced skill without saying what evidences it', () => {
    // Mirrors ck_profile_skills__evidence. A response violating it would fail on insert, far from
    // the service that produced it.
    for (const capture of captures.filter((c) => c.httpStatus === 200)) {
      const body = capture.body as { skills: { status: string; evidence_kind: string | null }[] };
      for (const skill of body.skills) {
        if (skill.status === 'evidenced') expect(skill.evidence_kind).not.toBeNull();
      }
    }
  });

  it('always explains a non-ok status', () => {
    for (const capture of captures.filter((c) => c.httpStatus === 200)) {
      const body = capture.body as { status: string; reason: string | null };
      if (body.status !== 'ok') expect(body.reason).toBeTruthy();
    }
  });
});

describe('the validators reject what they should', () => {
  it('rejects an evidenced skill with no evidence kind', () => {
    const good = captures.find((c) => c.name === 'ok');
    expect(good).toBeDefined();
    const broken = structuredClone(good!.body) as {
      skills: { status: string; evidence_kind: string | null }[];
    };
    broken.skills[0] = { ...broken.skills[0]!, status: 'evidenced', evidence_kind: null };
    expect(isParseResponse(broken)).toBe(false);
  });

  it('rejects a non-ok status with no reason', () => {
    const unknown = captures.find((c) => c.name === 'unknown-scan');
    expect(unknown).toBeDefined();
    const broken = { ...(unknown!.body as object), reason: null };
    expect(isParseResponse(broken)).toBe(false);
  });

  it('rejects a completeness outside 0..1', () => {
    const good = captures.find((c) => c.name === 'ok');
    expect(isParseResponse({ ...(good!.body as object), completeness: 1.5 })).toBe(false);
  });

  it('rejects an error envelope with no correlation id', () => {
    // The correlation id is what ties a user's report to a log line. An envelope without one is
    // unusable in exactly the situation it exists for.
    expect(isServiceError({ error: { code: 'X', message: 'y', details: [], retryable: false } })).toBe(
      false,
    );
  });
});
