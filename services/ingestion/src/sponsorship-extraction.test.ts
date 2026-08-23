/**
 * ADR-0039's two rules, and the real spans that produced them.
 *
 * **The regression cases are verbatim from the Zoox board**, captured 2026-08-23. Two of the three
 * spans that mention the topic on a real 239-posting board are the wrong sense of the word, and the
 * third is genuine and still does not state availability. If a future change reintroduces the bug,
 * it fails on the evidence rather than on a paraphrase of it.
 */

import { describe, expect, it } from 'vitest';

import {
  SPONSORSHIP_EXTRACTOR_VERSION,
  extractSponsorship,
  type BenefitKind,
} from './sponsorship-extraction.ts';

function read(text: string) {
  return extractSponsorship({ description: text, requirementsText: null });
}

function statusOf(text: string, kind: BenefitKind) {
  return read(text)[kind].status;
}

describe('the real Zoox spans — all three are unknown', () => {
  it('a mention of the topic is not a statement: "earning executive sponsorship"', () => {
    const found = read(
      'Lead the development of generative scenario creation capabilities, partnering with stakeholders across engineering and earning executive sponsorship.',
    );

    expect(found.visa_sponsorship.status).toBe('unknown');
    expect(found.visa_sponsorship.span).toBeNull();
  });

  it('a mention of the topic is not a statement: "relocation strategies"', () => {
    const found = read(
      'Position our culture compellingly to high-profile executive candidates, often involving complex compensation, negotiation, and relocation strategies.',
    );

    expect(found.relocation_support.status).toBe('unknown');
  });

  it('"details will be provided" is not a statement that the benefit exists', () => {
    // The one genuine span on the board. `and` and `details` both break adjacency, which is the whole
    // mechanism — the predicate's subject is the details, not the sponsorship.
    const found = read(
      'Company visa sponsorship and relocation assistance details will be provided during the interview process.',
    );

    expect(found.visa_sponsorship.status).toBe('unknown');
    expect(found.relocation_support.status).toBe('unknown');
  });

  it('a requirement on the candidate is not an employer offer', () => {
    const found = read(
      'Continued employment in this position is contingent upon obtaining valid US work authorization and visa eligibility.',
    );

    expect(found.visa_sponsorship.status).toBe('unknown');
  });
});

describe('a bare noun never counts — the qualifier is what makes it about immigration', () => {
  it.each([
    'We are looking for someone who can earn sponsorship from senior leadership.',
    'This role owns our relocation strategy for the west coast.',
    'Executive sponsorship of the programme is already secured.',
  ])('leaves an unqualified mention unknown: %s', (text) => {
    const found = read(text);
    expect(found.visa_sponsorship.status).toBe('unknown');
    expect(found.relocation_support.status).toBe('unknown');
  });
});

describe('what does count as a statement', () => {
  it.each([
    ['Visa sponsorship is available for this role.', 'visa_sponsorship'],
    ['Relocation assistance is provided.', 'relocation_support'],
    ['Immigration assistance available.', 'immigration_assistance'],
    ['We provide visa sponsorship for exceptional candidates.', 'visa_sponsorship'],
    ['We offer a relocation package.', 'relocation_support'],
  ] as const)('reads %s as stated_available', (text, kind) => {
    expect(statusOf(text, kind)).toBe('stated_available');
  });

  it('carries the sentence as published, never normalized', () => {
    const text = 'Visa sponsorship is available for this role.';
    expect(read(text).visa_sponsorship.span).toBe(text);
  });
});

describe('a refusal is a statement too, and outranks an offer', () => {
  it.each([
    'Visa sponsorship is not available for this position.',
    'We do not offer visa sponsorship.',
    'We are unable to provide visa sponsorship at this time.',
  ])('reads a refusal as stated_unavailable: %s', (text) => {
    expect(statusOf(text, 'visa_sponsorship')).toBe('stated_unavailable');
  });

  it('does not read a refusal as an offer merely because the words overlap', () => {
    // "not available" shares every token with "available" but one.
    expect(statusOf('Visa sponsorship is not available.', 'visa_sponsorship')).not.toBe('stated_available');
  });
});

describe('the three benefits are independent', () => {
  it('decides each separately from one posting', () => {
    const found = read(
      'Visa sponsorship is available.\nRelocation assistance is not offered.\nWe say nothing about immigration paperwork.',
    );

    expect(found.visa_sponsorship.status).toBe('stated_available');
    expect(found.relocation_support.status).toBe('stated_unavailable');
    expect(found.immigration_assistance.status).toBe('unknown');
  });

  it('reads requirement lists as well as the description', () => {
    const found = extractSponsorship({
      description: null,
      requirementsText: 'Qualifications:\n- Visa sponsorship is available for this role',
    });

    expect(found.visa_sponsorship.status).toBe('stated_available');
  });
});

describe('what this extractor may never produce', () => {
  it('never returns inferred_likely from prose', () => {
    // ADR-0039 rule 3: it belongs to registries and aggregated outcomes, which have no table and no
    // join key. The schema refuses it too; this asserts the code never tries.
    const texts = [
      'We sponsor many international employees every year.',
      'Our team is highly international.',
      'Visa sponsorship is available.',
      'Most of our engineers relocated from abroad.',
    ];
    for (const text of texts) {
      const found = read(text);
      for (const kind of ['visa_sponsorship', 'relocation_support', 'immigration_assistance'] as const) {
        expect(found[kind].status).not.toBe('inferred_likely');
      }
    }
  });

  it('never produces a status without a span', () => {
    const found = read('Visa sponsorship is available. Relocation assistance is provided.');
    for (const kind of ['visa_sponsorship', 'relocation_support', 'immigration_assistance'] as const) {
      if (found[kind].status !== 'unknown') expect(found[kind].span).not.toBeNull();
    }
  });

  it('returns unknown with a null span for text that says nothing', () => {
    const found = read('We are looking for a strong embedded engineer to join the firmware team.');
    expect(found.visa_sponsorship).toEqual({ status: 'unknown', span: null });
  });

  it('handles null text without inventing anything', () => {
    expect(extractSponsorship({ description: null, requirementsText: null }).visa_sponsorship.status).toBe('unknown');
  });
});

describe('reproducibility', () => {
  it('stamps a version distinct from the skill extractor', () => {
    expect(SPONSORSHIP_EXTRACTOR_VERSION).toBe('sponsorship-statement@1.0.0');
    expect(SPONSORSHIP_EXTRACTOR_VERSION.startsWith('alias-scan')).toBe(false);
  });

  it('yields identical results for identical input', () => {
    const text = 'We provide visa sponsorship. Relocation assistance is not available.';
    expect(read(text)).toEqual(read(text));
  });
});
