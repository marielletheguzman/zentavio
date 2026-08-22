import { describe, expect, it } from 'vitest';

import { EXTRACTOR_VERSION, extractSkills, rowsFor, weightFor, type AliasEntry } from './skill-extraction.ts';

const KUBERNETES = '01a02a0b-7d56-7000-ac78-000000000001';
const TERRAFORM = '01a02a0b-7d56-7000-ac78-000000000002';
const AWS = '01a02a0b-7d56-7000-ac78-000000000003';
const GO = '01a02a0b-7d56-7000-ac78-000000000004';

const ALIASES: readonly AliasEntry[] = [
  { normalized: 'kubernetes', skillId: KUBERNETES },
  { normalized: 'k8s', skillId: KUBERNETES },
  { normalized: 'terraform', skillId: TERRAFORM },
  { normalized: 'aws', skillId: AWS },
  { normalized: 'amazon web services', skillId: AWS },
  { normalized: 'go', skillId: GO },
];

function extract(text: { description?: string | null; requirementsText?: string | null }) {
  return extractSkills(
    { description: text.description ?? null, requirementsText: text.requirementsText ?? null },
    ALIASES,
  );
}

describe('what it finds', () => {
  it('resolves a skill named in the requirement list', () => {
    const [found] = extract({ requirementsText: 'Qualifications:\n- 5 years of Kubernetes' });

    expect(found).toMatchObject({ skillId: KUBERNETES, isRequired: true, section: 'requirements' });
  });

  it('resolves through an alias, not through the skill name', () => {
    // `skill_aliases.normalized` is the resolution key; string equality on a name would miss "k8s".
    expect(extract({ requirementsText: '- Strong k8s experience' })[0]?.skillId).toBe(KUBERNETES);
  });

  it('finds nothing the graph does not curate', () => {
    // Recall is bounded by the alias registry, and that is the honest half of ADR-0035: the scan has
    // no vocabulary of its own, so it cannot invent a skill.
    expect(extract({ requirementsText: '- Rust, Elixir, and Haskell' })).toEqual([]);
    expect(extract({ requirementsText: '- Experience with container orchestration' })).toEqual([]);
  });

  it('resolves a hyphenated compound to its parts, which is a known overclaim', () => {
    // "Kubernetes-like" normalizes to "kubernetes like" and therefore matches. This is not a bug to
    // patch here: the normalization is deliberately identical to the one `skill_aliases.normalized`
    // is keyed on, and diverging them would make resolution miss silently everywhere else
    // (`packages/db/src/seed.ts`). It is recorded rather than hidden, and the model path is where
    // better recall and better precision both belong.
    const [found] = extract({ requirementsText: '- Deep experience with Kubernetes-like orchestration' });

    expect(found?.skillId).toBe(KUBERNETES);
  });

  it('matches whole tokens rather than substrings', () => {
    // `go` inside "going" would otherwise make every posting ask for Go.
    expect(extract({ requirementsText: '- Going to standups' })).toEqual([]);
    expect(extract({ requirementsText: '- Go and Terraform' }).map((skill) => skill.skillId).sort()).toEqual(
      [GO, TERRAFORM].sort(),
    );
  });

  it('counts a longer alias once rather than twice', () => {
    // "amazon web services" contains no shorter alias here, but a nested one must not double-fire.
    const found = extract({ requirementsText: '- Amazon Web Services' });

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ skillId: AWS, mentions: 1 });
  });
});

describe('what it may claim', () => {
  it('never marks a description mention as required', () => {
    // "Our platform runs on Kubernetes" is not "5 years of Kubernetes". Treating it as a requirement
    // produces a gap the person does not have, and they never see the sentence.
    const [found] = extract({ description: 'Our platform runs on Kubernetes and scales nicely.' });

    expect(found).toMatchObject({ isRequired: false, section: 'description' });
  });

  it('marks required when the requirement list asks, even if the prose also mentions it', () => {
    const [found] = extract({
      requirementsText: 'Qualifications:\n- Production Kubernetes',
      description: 'Our platform runs on Kubernetes.',
    });

    expect(found).toMatchObject({ isRequired: true, section: 'requirements', mentions: 2 });
  });

  it('carries the sentence it came from, never a paraphrase', () => {
    const [found] = extract({ requirementsText: 'Qualifications:\n- 5 years of Terraform in anger' });

    expect(found?.sourceSpan).toBe('5 years of Terraform in anger');
  });

  it('shows the sentence that asks, not the one that mentions', () => {
    // Requirements are scanned first, so the span a reader checks is the one that made it required.
    const [found] = extract({
      requirementsText: '- Kubernetes at scale',
      description: 'We happen to run Kubernetes.',
    });

    expect(found?.sourceSpan).toBe('Kubernetes at scale');
  });
});

describe('weights', () => {
  it('weighs a requirement above a mention', () => {
    const required = weightFor([{ section: 'requirements', sentence: 'x' }]);
    const mentioned = weightFor([{ section: 'description', sentence: 'x' }]);

    expect(required).toBeGreaterThan(mentioned);
  });

  it('rewards repetition, with a ceiling', () => {
    const once = weightFor([{ section: 'requirements', sentence: 'a' }]);
    const twice = weightFor([
      { section: 'requirements', sentence: 'a' },
      { section: 'description', sentence: 'b' },
    ]);
    const many = weightFor(
      Array.from({ length: 20 }, (_, index) => ({ section: 'requirements' as const, sentence: `s${index}` })),
    );

    expect(twice).toBeGreaterThan(once);
    expect(many).toBeLessThanOrEqual(1);
  });

  it('is deterministic, so a match stays re-derivable', () => {
    // A weight nobody can recompute makes `matches` irreproducible, which is why no model returns one.
    const text = { requirementsText: '- Kubernetes\n- Terraform', description: 'We use AWS.' };

    expect(extract(text)).toEqual(extract(text));
  });

  it('orders heaviest first, and breaks ties stably', () => {
    const found = extract({ requirementsText: '- Kubernetes', description: 'We use Terraform and AWS.' });

    expect(found[0]?.skillId).toBe(KUBERNETES);
    expect(found.map((skill) => skill.weight)).toEqual([...found.map((skill) => skill.weight)].sort((a, b) => b - a));
  });
});

describe('the rows it writes', () => {
  const rows = rowsFor('01a02a0b-7d56-7000-ac78-00000000000a', extract({ requirementsText: '- Kubernetes' }), () => 'row-id');

  it('always claims description-extraction, never stated-requirement', () => {
    // No source states requirements structurally. Writing the stronger label would end the
    // distinction the column exists for, on the first row (ADR-0035).
    expect(rows[0]?.basis).toBe('description-extraction');
  });

  it('records the extractor and no prompt, because no model was involved', () => {
    expect(rows[0]).toMatchObject({ extractor_version: EXTRACTOR_VERSION, prompt_version: null });
  });

  it('writes no row when nothing resolves', () => {
    // Silence rather than a guess: matching then reports `unknown`, which is a state the schema has.
    expect(rowsFor('posting', extract({ description: 'A lovely place to work.' }), () => 'row-id')).toEqual([]);
  });
});
