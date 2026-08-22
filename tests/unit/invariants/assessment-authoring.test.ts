/**
 * The standard an authored instrument has to meet (ADR-0030).
 *
 * **The acceptance target is not that items exist.** It is that each one can support a defensible
 * claim about what a pass did — and did not — evidence. Most of that is judgement and no test can
 * hold it. These hold the part that is checkable, and the part that fails silently when it is wrong:
 *
 * - an item that names no capability cannot appear in "passing showed…"
 * - an item whose answer cites no documentation is an opinion with a scoring rule attached
 * - an item whose key is not among its options is answered wrongly by everybody, and nothing reports it
 * - an instrument that does not say what it fails to show is making the broader claim by omission
 *
 * The seed loader validates all of this before writing. This runs it against what is actually
 * authored, so a bad instrument fails here rather than at somebody's next `pnpm seed`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  validateAssessmentSeed,
  type AssessmentSeedFile,
} from '../../../packages/db/src/assessment-seeds.ts';

const DIRECTORY = fileURLToPath(new URL('../../../packages/db/seeds/assessments/', import.meta.url));

const authored = readdirSync(DIRECTORY)
  .filter((name) => name.endsWith('.json'))
  .map((name) => ({
    name,
    seed: JSON.parse(readFileSync(join(DIRECTORY, name), 'utf8')) as AssessmentSeedFile,
  }));

describe('every authored instrument', () => {
  it('exists at all, so a passing run means something', () => {
    expect(authored.length).toBeGreaterThan(0);
  });

  it.each(authored.map(({ name, seed }) => [name, seed] as const))(
    '%s passes the loader’s own validation',
    (_name, seed) => {
      expect(validateAssessmentSeed(seed)).toEqual([]);
    },
  );

  it.each(authored.map(({ name, seed }) => [name, seed] as const))(
    '%s says what passing does not show',
    (_name, seed) => {
      // The negative half is the one a reader most needs and the one most easily left out. It also
      // cannot be derived from the items — it is a judgement about the distance between recall and
      // competence.
      const negative = seed.assessment.doesNotEvidence.toLowerCase();
      expect(negative).toContain('does not');
      // Unproctored and unattributed is a property of every instrument here, and saying so is what
      // keeps a pass from reading as a credential.
      expect(negative).toMatch(/unproctored|who sat it/);
    },
  );

  it.each(authored.map(({ name, seed }) => [name, seed] as const))(
    '%s cites documentation on every item, from one authority',
    (_name, seed) => {
      const hosts = new Set(seed.items.map((item) => new URL(item.sourceUrl).host));

      for (const item of seed.items) {
        expect(item.sourceUrl, `item ${String(item.position)}`).toMatch(/^https:\/\//);
      }
      // Not a rule about which host — a rule that an instrument does not wander. Items sourced from
      // five different places are five different standards of correctness.
      expect(hosts.size).toBe(1);
    },
  );

  it.each(authored.map(({ name, seed }) => [name, seed] as const))(
    '%s states a distinct capability per item',
    (_name, seed) => {
      // Two items evidencing the same sentence are one item asked twice, and a pass built from them
      // claims more coverage than it has.
      const claims = seed.items.map((item) => item.evidences.trim().toLowerCase());
      expect(new Set(claims).size).toBe(claims.length);
    },
  );

  it.each(authored.map(({ name, seed }) => [name, seed] as const))(
    '%s sets a threshold that neither passes everybody nor nobody',
    (_name, seed) => {
      const { passThreshold, itemCount } = seed.assessment;

      expect(passThreshold).toBeGreaterThan(itemCount / 2);
      expect(passThreshold).toBeLessThan(itemCount);
    },
  );
});
