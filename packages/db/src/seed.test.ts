/**
 * The parts of the seed loader that are decidable without a database.
 *
 * `normalizeAlias` is the one that matters most. It decides whether an extracted phrase finds its
 * skill, and it must stay in step with whatever normalization the parser applies — if the two ever
 * disagree, resolution misses silently and the skill lands in `unmatched`, which reads as a coverage
 * gap rather than a bug.
 */

import { describe, expect, it } from 'vitest';
import {
  loadSeedDirectory,
  normalizeAlias,
  requiresCycles,
  seedsDirectory,
  validateAcrossSeeds,
  validateSeed,
  type SeedFile,
} from './seed.ts';

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

describe('requiresCycles', () => {
  it('finds nothing in an acyclic graph', () => {
    expect(
      requiresCycles([
        { from: 'kubernetes', to: 'containers', type: 'requires', weight: 0.9 },
        { from: 'containers', to: 'linux', type: 'requires', weight: 0.8 },
      ]),
    ).toEqual([]);
  });

  it('finds a ring the database cannot see', () => {
    // Every one of these rows satisfies ck_skill_edges__no_self. Only the set is cyclic, and a
    // cyclic prerequisite graph means the gap has no first step.
    const cycles = requiresCycles([
      { from: 'a', to: 'b', type: 'requires', weight: 0.5 },
      { from: 'b', to: 'c', type: 'requires', weight: 0.5 },
      { from: 'c', to: 'a', type: 'requires', weight: 0.5 },
    ]);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.[0]).toBe(cycles[0]?.at(-1));
  });

  it('ignores cycles among edge types that are not requires', () => {
    // `transfers_to` is deliberately stored both ways — AWS transfers to Azure and back — and
    // `adjacent_to` is required to be symmetric. Neither is walked for ordering.
    expect(
      requiresCycles([
        { from: 'aws', to: 'azure', type: 'transfers_to', weight: 0.65 },
        { from: 'azure', to: 'aws', type: 'transfers_to', weight: 0.7 },
        { from: 'prometheus', to: 'grafana', type: 'adjacent_to', weight: 0.7 },
        { from: 'grafana', to: 'prometheus', type: 'adjacent_to', weight: 0.7 },
      ]),
    ).toEqual([]);
  });
});

describe('validateSeed — the graph', () => {
  const base = {
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
    skills: [
      { slug: 'kubernetes', name: 'Kubernetes', kind: 'technology', sourceUrl: null, aliases: ['k8s'] },
      { slug: 'containers', name: 'Containers', kind: 'practice', sourceUrl: null, aliases: [] },
    ],
  };

  it('rejects an edge to a skill the file does not define', () => {
    // The database would reject this too, as a foreign key violation naming a uuid. Here it names
    // the slug, which is the thing an author can act on.
    const problems = validateSeed({
      ...base,
      edges: [{ from: 'kubernetes', to: 'openshift', type: 'requires', weight: 0.5 }],
    });
    expect(problems).toContain('edge references unknown skill: openshift');
  });

  it('rejects a requires-cycle before it reaches the database', () => {
    const problems = validateSeed({
      ...base,
      edges: [
        { from: 'kubernetes', to: 'containers', type: 'requires', weight: 0.9 },
        { from: 'containers', to: 'kubernetes', type: 'requires', weight: 0.9 },
      ],
    });
    expect(problems.some((p) => p.startsWith('requires-edges form a cycle'))).toBe(true);
  });

  it('rejects a careerSkills entry for an unknown skill', () => {
    const problems = validateSeed({
      ...base,
      careerSkills: [{ skill: 'openshift', weight: 0.5, cluster: 'core', marketScope: null }],
    });
    expect(problems).toContain('careerSkills references unknown skill: openshift');
  });

  it('rejects a market scope that is not an ISO alpha-2 code', () => {
    const problems = validateSeed({
      ...base,
      careerSkills: [{ skill: 'kubernetes', weight: 0.5, cluster: 'core', marketScope: 'germany' }],
    });
    expect(problems.some((p) => p.includes('not an ISO 3166-1 alpha-2 code'))).toBe(true);
  });

  it('allows the same skill globally and market-scoped', () => {
    // The pair a gap needs: a global requirement plus a stronger one in a specific market.
    const problems = validateSeed({
      ...base,
      careerSkills: [
        { skill: 'kubernetes', weight: 0.9, cluster: 'core', marketScope: null },
        { skill: 'kubernetes', weight: 0.95, cluster: 'core', marketScope: 'DE' },
      ],
    });
    expect(problems).toEqual([]);
  });

  it('rejects the same skill twice at the same scope', () => {
    const problems = validateSeed({
      ...base,
      careerSkills: [
        { skill: 'kubernetes', weight: 0.9, cluster: 'core', marketScope: null },
        { skill: 'kubernetes', weight: 0.4, cluster: 'peripheral', marketScope: null },
      ],
    });
    expect(problems.some((p) => p.startsWith('duplicate careerSkills entry'))).toBe(true);
  });
});


/**
 * Seeds became a directory when a second career track arrived, and the interesting failure is the
 * one that only exists between files: skills are upserted by slug, so two tracks describing the
 * same skill differently do not collide — the later file silently wins and the earlier track's
 * closed set changes underneath it.
 */
describe('more than one seed file', () => {
  const track = (slug: string, skills: SeedFile['skills']): { name: string; seed: SeedFile } => ({
    name: `${slug}.json`,
    seed: {
      career: {
        slug,
        name: slug,
        family: 'software-it',
        description: 'x',
        profession: null,
        licenceGated: false,
        sourceTier: 3,
        basis: 'curated',
        sourceUrl: null,
      },
      skills,
      careerSkills: [],
      edges: [],
    } as unknown as SeedFile,
  });

  const python = { slug: 'python', name: 'Python', kind: 'technology', sourceUrl: null, aliases: [] };

  it('accepts two tracks reusing a skill described identically', () => {
    // Reuse is the point: a shared slug is what makes two tracks comparable.
    expect(
      validateAcrossSeeds([track('a', [python]), track('b', [python])] as never),
    ).toEqual([]);
  });

  it('refuses two tracks describing the same slug differently', () => {
    const renamed = { ...python, name: 'Python 3' };
    const problems = validateAcrossSeeds([track('a', [python]), track('b', [renamed])] as never);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('python');
  });

  it('refuses two files claiming the same career slug', () => {
    const problems = validateAcrossSeeds([track('a', [python]), track('a', [python])] as never);
    expect(problems.some((problem) => problem.includes('career slug a'))).toBe(true);
  });

  it('loads every seed file in the directory, and each one is valid on its own', async () => {
    // The directory is data, so this is the test that notices a new track being added broken.
    const seeds = await loadSeedDirectory(seedsDirectory);

    expect(seeds.length).toBeGreaterThanOrEqual(2);
    for (const { name, seed } of seeds) {
      expect(validateSeed(seed), name).toEqual([]);
    }
    expect(validateAcrossSeeds(seeds)).toEqual([]);
  });

  it('carries a profession on the track that names a protected title', async () => {
    // `ck_careers__licence_profession` permits a profession without `licenceGated`, and its comment
    // says why: the same occupation is regulated in one jurisdiction and not another. Bavaria gates
    // the title `Ingenieur`, not engineering work — so the track names the profession and stays
    // ungated, which is what lets the BayIngG rows reach the person without forcing `unknown`.
    const seeds = await loadSeedDirectory(seedsDirectory);
    const engineer = seeds.find(({ seed }) => seed.career.slug === 'computer-engineer');

    expect(engineer?.seed.career.profession).toBe('ingenieur-protected-title');
    expect(engineer?.seed.career.licenceGated).toBe(false);
  });
});
