/**
 * ADR-0030's compliance check: exactly one thing may promote a skill to `evidenced` by assessment.
 *
 * The decision is not "we intend to keep promotion in one place" — it is that a second writer is how
 * a promotion appears in somebody's profile with no basis anyone can show. A schema constraint holds
 * half of it (`ck_profile_skills__attempt_verified`: a `verified_at` with no attempt is refused);
 * this holds the half a constraint cannot, which is *who is allowed to write the pair*.
 *
 * It reads source text, which is a blunt instrument. It is here anyway, because the failure it
 * catches is somebody adding a well-meaning second promotion path in a service or a route, and no
 * type or constraint would notice.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Where a second writer would plausibly be added. Not the whole tree — tests and docs may say it. */
const SEARCHED = ['packages', 'services', 'apps', 'connectors'];

const SKIPPED = new Set(['node_modules', 'dist', '.next', 'coverage', '__pycache__']);

/** The one module ADR-0030 allows to write the pair. */
const PROMOTION_WRITER = join('packages', 'db', 'src', 'repositories', 'assessments.ts');

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (SKIPPED.has(entry)) continue;
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    // A test may assert about promotion; it may not perform one in production code.
    if (/\.test\.tsx?$/.test(entry)) continue;
    found.push(full);
  }
  return found;
}

const files = SEARCHED.flatMap((directory) => sourceFiles(join(ROOT, directory))).map((path) => ({
  relative: path.slice(ROOT.length),
  text: readFileSync(path, 'utf8'),
}));

describe('only one module promotes a skill by assessment', () => {
  it('finds source files at all, so a passing run means something', () => {
    // A glob that silently matches nothing is a test that passes forever.
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((file) => file.relative.replace(/\\/g, '/') === PROMOTION_WRITER.replace(/\\/g, '/'))).toBe(true);
  });

  it('writes evidence_kind assessment nowhere else', () => {
    const writers = files
      .filter((file) => /evidence_kind\s*:\s*'assessment'/.test(file.text))
      .map((file) => file.relative.replace(/\\/g, '/'));

    expect(writers).toEqual([PROMOTION_WRITER.replace(/\\/g, '/')]);
  });

  it('never writes verified_at without the attempt that produced it', () => {
    // **The pair is the invariant, not the column.** `profiles.ts` legitimately writes `verified_at`
    // — it copies a verification forward when a correction creates a new profile version — so the
    // rule cannot be "one writer". It is that verification and its basis travel together: a version
    // carrying `verified_at` alone is a promotion whose basis was lost in the copy, and the database
    // now refuses it (`ck_profile_skills__attempt_verified`).
    //
    // This caught exactly that: `applyCorrection` carried `verified_at` and not the attempt id, and
    // would have started failing the moment somebody with an assessed skill corrected an unrelated
    // one.
    const offenders = files
      // The boundary matters: `email_verified_at` on `users` is a different column with a different
      // meaning, and matching it made this fail against `erasure.ts`, which only mentions
      // `profile_skills` in a comment.
      .filter((file) => /(?<![a-z_])verified_at\s*:/.test(file.text))
      // `person_facts` has its own `verified_at` too. This rule is about `profile_skills`.
      .filter((file) => /profile_skills|ProfileSkill/.test(file.text))
      .filter((file) => !/verified_attempt_id\s*:/.test(file.text))
      .map((file) => file.relative.replace(/\\/g, '/'));

    expect(offenders).toEqual([]);
  });

  it('has no reader of grants_evidence', () => {
    // ADR-0030 leaves certification promotion undecided, and `grants_evidence` is the flag it would
    // hang from. A reader appearing means that decision is being made by accident.
    const readers = files
      .filter((file) => /grants_evidence/.test(file.text))
      .map((file) => file.relative.replace(/\\/g, '/'))
      // The schema and the repository *type* the column; typing it is not reading it.
      .filter(
        (relative) =>
          relative !== 'packages/db/src/schema.ts' &&
          relative !== 'packages/db/src/repositories/learning.ts',
      );

    expect(readers).toEqual([]);
  });
});
