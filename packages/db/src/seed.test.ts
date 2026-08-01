/**
 * The parts of the seed loader that are decidable without a database.
 *
 * `normalizeAlias` is the one that matters most. It decides whether an extracted phrase finds its
 * skill, and it must stay in step with whatever normalization the parser applies — if the two ever
 * disagree, resolution misses silently and the skill lands in `unmatched`, which reads as a coverage
 * gap rather than a bug.
 */

import { describe, expect, it } from 'vitest';
import { normalizeAlias, validateSeed, type SeedFile } from './seed.ts';

function seedWith(skills: SeedFile['skills']): SeedFile {
  return {
    career: {
      slug: 'cloud-platform-engineer',
      name: 'Cloud / Platform Engineer',
      family: 'software-it',
      description: null,
      profession: null,
      licenceGated: false,
      sourceTier: 3,
      basis: 'curated',
      sourceUrl: null,
    },
    skills,
  };
}

const skill = (slug: string, name: string, aliases: string[] = []): SeedFile['skills'][number] => ({
  slug,
  name,
  kind: 'technology',
  sourceUrl: null,
  aliases,
});

describe('normalizeAlias', () => {
  it('folds case and collapses punctuation to a single space', () => {
    expect(normalizeAlias('Kubernetes (K8s)')).toBe('kubernetes k8s');
    expect(normalizeAlias('CI/CD')).toBe('ci cd');
    expect(normalizeAlias('  GitLab   CI  ')).toBe('gitlab ci');
  });

  it('keeps + and #, because they are part of the name', () => {
    // 'c++' normalizing to 'c' would collide with the C language and resolve the wrong skill.
    expect(normalizeAlias('C++')).toBe('c++');
    expect(normalizeAlias('C#')).toBe('c#');
    expect(normalizeAlias('c++')).not.toBe(normalizeAlias('c'));
  });

  it('is idempotent', () => {
    // It runs over stored aliases and over freshly extracted phrases. If a second pass changed the
    // result, the two paths would disagree.
    for (const value of ['Kubernetes (K8s)', 'CI/CD', 'Node.js', 'C#']) {
      expect(normalizeAlias(normalizeAlias(value))).toBe(normalizeAlias(value));
    }
  });

  it('treats accented and decomposed forms as the same key', () => {
    expect(normalizeAlias('Café')).toBe(normalizeAlias('Café'));
  });

  it('produces an empty string for input with nothing to match on', () => {
    // Worth knowing rather than discovering: a phrase of pure punctuation must not become a key
    // that silently claims a skill.
    expect(normalizeAlias('---')).toBe('');
  });
});

describe('validateSeed', () => {
  it('accepts a well-formed seed', () => {
    expect(validateSeed(seedWith([skill('kubernetes', 'Kubernetes', ['k8s'])]))).toEqual([]);
  });

  it('rejects a duplicate slug', () => {
    const problems = validateSeed(
      seedWith([skill('kubernetes', 'Kubernetes'), skill('kubernetes', 'Kubernetes Again')]),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('duplicate skill slug: kubernetes');
  });

  it('rejects a slug that is not kebab-case, because slugs are a closed set prompts depend on', () => {
    expect(validateSeed(seedWith([skill('Kubernetes', 'Kubernetes')]))[0]).toContain('kebab-case');
    expect(validateSeed(seedWith([skill('k8s_cluster', 'K8s')]))[0]).toContain('kebab-case');
  });

  it('rejects an alias claimed by two skills, and names both', () => {
    // The database enforces this too (uq_skill_aliases__normalized), but a constraint violation
    // mid-load reports one row and leaves the operator guessing which pair collided.
    const problems = validateSeed(
      seedWith([skill('python', 'Python', ['py']), skill('python-language', 'Python Language', ['Py'])]),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('python');
    expect(problems[0]).toContain('python-language');
  });

  it('treats a display name as an alias for collision purposes', () => {
    // The name is inserted as an alias, so two skills sharing a name collide even with no explicit
    // alias overlap — and it must fail in validation rather than at the INSERT.
    const problems = validateSeed(seedWith([skill('go', 'Go'), skill('go-lang', 'go')]));
    expect(problems).toHaveLength(1);
  });

  it('reports every problem at once rather than the first', () => {
    // A partially reported seed means fixing one problem, re-running, and finding the next.
    const problems = validateSeed(
      seedWith([skill('Bad_Slug', 'One'), skill('also_bad', 'Two'), skill('fine', 'Three')]),
    );
    expect(problems.length).toBeGreaterThanOrEqual(2);
  });
});
