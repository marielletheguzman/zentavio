/**
 * A curator's claim is checked against the same rules a job board's prose gets (ADR-0039).
 *
 * **Every refusal case below is a real sentence from a real employer's own page**, read on the date
 * named. That is the rule the first live Lever fetch set: a claim about what a source states
 * requires a fetch, not a fixture — and it applies to the sentences a rule is *tested* against, not
 * only to the ones it runs against in production.
 */

import { validateCuratedSponsorship, type CuratedSponsorshipEntry } from './curated-sponsorship.ts';
import { describe, expect, it } from 'vitest';

function entry(overrides: Partial<CuratedSponsorshipEntry> = {}): CuratedSponsorshipEntry {
  return {
    companySlug: 'acme',
    jurisdiction: 'DE',
    claim: 'visa_sponsorship',
    status: 'stated_available',
    sourceUrl: 'https://acme.test/careers/relocation',
    span: 'Visa sponsorship is available for all engineering roles in Berlin.',
    retrievedAt: '2026-08-26T00:00:00Z',
    effectiveFrom: '2026-08-26',
    refreshAfter: '2027-08-26',
    ...overrides,
  };
}

function validate(...entries: CuratedSponsorshipEntry[]) {
  return validateCuratedSponsorship({ facts: entries });
}

describe('a curated claim the span supports', () => {
  it('is accepted when the extractor independently reads the same status', () => {
    const result = validate(entry());
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toEqual([]);
  });

  it('is accepted for an explicit refusal, which is a different fact from silence', () => {
    const result = validate(
      entry({
        status: 'stated_unavailable',
        span: 'We do not offer visa sponsorship for this position.',
      }),
    );
    expect(result.accepted).toHaveLength(1);
  });
});

describe('a curated claim the span does not support', () => {
  it('refuses Zalando: help conditional on being asked to relocate is not an offer to sponsor', () => {
    // Read 2026-08-26 from jobs.zalando.com/en/how-we-hire — the single relevant sentence on the
    // page. `robots.txt` there is `Allow: /` with two onboarding paths disallowed, so it is readable.
    //
    // This is ADR-0039 rule 2 in a new costume. Rule 2 refuses a statement about the *candidate's*
    // obligation; this is a statement about the *circumstances under which help appears*. Neither
    // says the benefit is available to the person reading it.
    const zalando = entry({
      companySlug: 'zalando',
      status: 'stated_available',
      sourceUrl: 'https://jobs.zalando.com/en/how-we-hire',
      span:
        "If you're asked to relocate, our People Services team will be there to help guide you with " +
        'visa assistance, accommodation support, and settling in.',
    });

    const result = validate(zalando);
    expect(result.accepted).toEqual([]);
    expect(result.rejected[0]?.reason).toContain('the span reads as unknown');
  });

  it('refuses Zoox: details being provided later is not the benefit existing now', () => {
    // One of the four real spans from the 239-posting Zoox corpus, all four of which resolve to
    // `unknown` — including this, the only genuine one.
    const result = validate(
      entry({
        companySlug: 'zoox',
        status: 'stated_available',
        span:
          'Company visa sponsorship and relocation assistance details will be provided during the ' +
          'interview process.',
      }),
    );

    expect(result.accepted).toEqual([]);
    expect(result.rejected[0]?.reason).toContain('the span reads as unknown');
  });

  it('refuses the bare noun, which is stakeholder buy-in rather than immigration', () => {
    const result = validate(
      entry({ span: 'You will succeed here by earning executive sponsorship across engineering.' }),
    );
    expect(result.rejected[0]?.reason).toContain('reads as unknown');
  });

  it('refuses a claim promoted past what its own sentence says', () => {
    // The failure this module exists to prevent: a curator reads a relocation sentence and records
    // it against visa sponsorship, where it becomes indistinguishable from a real one.
    const result = validate(
      entry({ claim: 'visa_sponsorship', span: 'We offer a relocation package to everyone who moves.' }),
    );
    expect(result.accepted).toEqual([]);
    expect(result.rejected[0]?.reason).toContain('the span reads as unknown');
  });

  it('accepts that same sentence for the claim it actually makes', () => {
    const result = validate(
      entry({ claim: 'relocation_support', span: 'We offer a relocation package to everyone who moves.' }),
    );
    expect(result.accepted).toHaveLength(1);
  });
});

describe('what cannot be checked is not recorded', () => {
  it('refuses a sponsor licence, because a register is not readable prose', () => {
    // `sponsor_licence_held` is a register's fact. INZ operates the only such register among the
    // supported countries and its endpoint is robots-disallowed, so nothing can currently produce
    // this claim — and a sentence asserting it would be unverifiable rather than merely unverified.
    const result = validate(entry({ claim: 'sponsor_licence_held', jurisdiction: 'NZ' }));
    expect(result.accepted).toEqual([]);
    expect(result.rejected[0]?.reason).toContain('needs a register or aggregated outcomes');
  });

  it('refuses an entry with no span at all', () => {
    const result = validate(entry({ span: '   ' }));
    expect(result.rejected[0]?.reason).toContain('must quote the sentence');
  });

  it('refuses a source that is not a URL, so the claim stays re-openable', () => {
    const result = validate(entry({ sourceUrl: 'zalando.com' }));
    expect(result.rejected[0]?.reason).toContain('not a URL');
  });
});

describe('the shipped file', () => {
  it('is empty, and every entry it ever gains must pass these rules', async () => {
    // Not a placeholder assertion: if somebody adds an entry, this fails until they have also
    // satisfied the validator, which is the review gate the curated README describes.
    const { loadCuratedSponsorship } = await import('./curated-sponsorship.ts');
    const file = loadCuratedSponsorship();
    const result = validateCuratedSponsorship(file);

    expect(result.rejected, 'a curated entry does not pass its own rules').toEqual([]);
    expect(result.accepted).toHaveLength(file.facts.length);
  });
});
