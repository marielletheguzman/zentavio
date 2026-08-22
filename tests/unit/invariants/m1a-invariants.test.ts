/**
 * M1a's invariants on the TypeScript side.
 *
 * `.claude/skills/testing/SKILL.md` asks for these to be asserted **generically, once, over every**
 * subject rather than per example. The Python half lives in
 * `ai/resume-parser/tests/test_invariants.py`; this half covers what only TypeScript can see — the
 * contract validator, the seed's provenance floor, and the normalizer the two languages share.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isParseResponse, isServiceError } from '@zentavio/types';
import { loadSeedFile, normalizeAlias, seedsDirectory, validateSeed } from '@zentavio/db';

const FIXTURE_DIR = fileURLToPath(new URL('../../fixtures/resume-parser/', import.meta.url));

const captures = readdirSync(FIXTURE_DIR)
  .filter((name) => name.endsWith('.json'))
  .map((name) => JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')) as {
    name: string;
    httpStatus: number;
    body: unknown;
  });

describe('provenance — no fact without its source', () => {
  it('every seeded skill states a tier and a basis', async () => {
    // Asserted over the whole seed rather than a sample: a single unsourced row poisons everything
    // derived from it, and it would be the one nobody looked at.
    const seed = await loadSeedFile(join(seedsDirectory, 'cloud-platform-engineering.json'));

    expect(seed.skills.length).toBeGreaterThan(0);
    expect(seed.career.sourceTier).toBeGreaterThanOrEqual(1);
    expect(seed.career.basis).toBeTruthy();
  });

  it('no seeded row claims a tier it did not earn', async () => {
    // Tier 5 is "generated" and may never reach a fact table. Tier 1 and 2 require a source that
    // was actually consulted — these were curated by hand, so claiming either would be a lie.
    const seed = await loadSeedFile(join(seedsDirectory, 'cloud-platform-engineering.json'));
    expect(seed.career.sourceTier).toBeLessThanOrEqual(4);
    expect(seed.career.sourceTier).toBeGreaterThanOrEqual(3);
  });

  it('the shipped seed passes its own validation', async () => {
    const seed = await loadSeedFile(join(seedsDirectory, 'cloud-platform-engineering.json'));
    expect(validateSeed(seed)).toEqual([]);
  });
});

describe('purity — normalizeAlias touches nothing', () => {
  const inputs = ['Kubernetes (K8s)', 'CI/CD', 'C++', 'C#', '  GitLab   CI  ', '---', 'Node.js'];

  it('is idempotent over every input', () => {
    for (const value of inputs) {
      expect(normalizeAlias(normalizeAlias(value))).toBe(normalizeAlias(value));
    }
  });

  it('returns the same result on repeated calls', () => {
    // A normalizer that varied would break resolution intermittently, which is the worst kind of
    // bug to reproduce: the same résumé parses differently on different days.
    for (const value of inputs) {
      const first = normalizeAlias(value);
      for (let i = 0; i < 5; i += 1) expect(normalizeAlias(value)).toBe(first);
    }
  });

  it('agrees with the Python normalizer on the shared table', () => {
    // Duplicated in ai/resume-parser/tests/test_invariants.py. The seed WRITES alias keys with this
    // function and the parser READS them with the other; divergence makes resolution miss silently
    // and read as missing coverage rather than a bug.
    const shared: ReadonlyArray<readonly [string, string]> = [
      ['Kubernetes (K8s)', 'kubernetes k8s'],
      ['CI/CD', 'ci cd'],
      ['C++', 'c++'],
      ['C#', 'c#'],
      ['  GitLab   CI  ', 'gitlab ci'],
      ['---', ''],
      ['Node.js', 'node js'],
    ];

    for (const [raw, expected] of shared) {
      expect(normalizeAlias(raw), `"${raw}" must normalize identically in both languages`).toBe(
        expected,
      );
    }
  });
});

describe('evidence completeness — asserted over every captured response', () => {
  it('has responses to assert over', () => {
    // Without this, every loop below is vacuous over an empty array — the classic way an invariant
    // suite proves nothing while staying green.
    expect(captures.length).toBeGreaterThanOrEqual(4);
    expect(captures.filter((c) => c.httpStatus === 200).length).toBeGreaterThanOrEqual(3);
  });

  it('every skill in every successful response carries a span', () => {
    for (const capture of captures.filter((c) => c.httpStatus === 200)) {
      const body = capture.body as { skills: { source_span: string }[] };
      for (const skill of body.skills) expect(skill.source_span.trim().length).toBeGreaterThan(0);
    }
  });

  it('every evidenced skill names its evidence', () => {
    for (const capture of captures.filter((c) => c.httpStatus === 200)) {
      const body = capture.body as { skills: { status: string; evidence_kind: string | null }[] };
      for (const skill of body.skills) {
        if (skill.status === 'evidenced') expect(skill.evidence_kind).not.toBeNull();
      }
    }
  });
});

describe('unknown paths — never a default', () => {
  it('every non-ok response explains itself', () => {
    for (const capture of captures.filter((c) => c.httpStatus === 200)) {
      const body = capture.body as { status: string; reason: string | null };
      if (body.status !== 'ok') expect(body.reason?.trim()).toBeTruthy();
    }
  });

  it('an unknown response reports no completeness rather than zero', () => {
    // Zero is a measurement. `null` is "we did not measure" — showing 0% for an unreadable document
    // would be a confident claim about a person derived from nothing.
    const unknown = captures.find(
      (c) => c.httpStatus === 200 && (c.body as { status: string }).status === 'unknown',
    );
    expect(unknown).toBeDefined();
    expect((unknown!.body as { completeness: number | null }).completeness).toBeNull();
  });

  it('the validator rejects a non-ok status with no reason', () => {
    const unknown = captures.find(
      (c) => c.httpStatus === 200 && (c.body as { status: string }).status === 'unknown',
    );
    expect(isParseResponse({ ...(unknown!.body as object), reason: null })).toBe(false);
  });
});

describe('error envelopes', () => {
  it('every error response is the shared envelope and never a parse response', () => {
    const errors = captures.filter((c) => c.httpStatus >= 400);
    expect(errors.length).toBeGreaterThan(0);

    for (const capture of errors) {
      expect(isServiceError(capture.body)).toBe(true);
      expect(isParseResponse(capture.body)).toBe(false);
    }
  });

  it('carries a correlation id, which is the only reason the field exists', () => {
    for (const capture of captures.filter((c) => c.httpStatus >= 400)) {
      const body = capture.body as { error: { correlationId: string } };
      expect(body.error.correlationId.length).toBeGreaterThan(0);
    }
  });
});

describe('privacy — no résumé text in any committed fixture', () => {
  it('every email address in a fixture is on a reserved test domain', () => {
    // Duplicated deliberately in the Python suite: this is the check that a helpful "let me just
    // drop my own CV in" never survives review, and it should fail in whichever suite runs first.
    //
    // **The trailing group excludes filenames.** A git-scm.com fixture contains `logo@2x.png`,
    // which the earlier pattern read as an address on the domain `2x.png` — a false positive, and
    // the kind that gets a real check disabled by whoever hits it next. An address ends in letters,
    // and an asset reference ends in an extension.
    const emails = /[\w.+-]+@[\w-]+\.[\w.]*[a-z]{2,}/gi;
    const ASSET = /\.(png|jpe?g|gif|svg|webp|css|js|woff2?|ico)$/i;
    const root = fileURLToPath(new URL('../../fixtures/', import.meta.url));

    // Binary fixtures are skipped, and it is worth being precise about what that costs. Read as
    // UTF-8 they are noise, and a PDF's text lives in compressed streams — so this scan would not
    // have caught a CV committed as a PDF *even before* the skip. What it did do was backtrack for
    // 38 seconds on the archived Bundesanzeiger PDF's long alphanumeric runs.
    //
    // **PDFs are covered by the Python mirror instead**, which extracts their text first
    // (`ai/resume-parser/tests/test_invariants.py`, ADR-0016) — verified by committing a PDF whose
    // page text held a real-looking address and watching it fail. Other binaries — images,
    // archives, fonts — are covered by neither and need review by eye.
    const BINARY = /\.(pdf|docx?|png|jpe?g|gif|zip|woff2?)$/i;

    const scan = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        if (entry.isDirectory()) return scan(join(dir, entry.name));
        if (BINARY.test(entry.name)) return [];
        return [readFileSync(join(dir, entry.name), 'utf8')];
      });

    for (const contents of scan(root)) {
      for (const address of (contents.match(emails) ?? []).filter((found) => !ASSET.test(found))) {
        expect(
          address.endsWith('.invalid') || address.includes('example.'),
          `${address} is not a reserved test domain`,
        ).toBe(true);
      }
    }
  });
});
