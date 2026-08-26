/**
 * The rules the discovery surface inherits, asserted on the mapping that carries them.
 *
 * Every case below is one of the rules `docs/roadmap/backlog.md` lists for this surface, and each
 * one names the failure it prevents rather than merely checking a field copies across.
 */

import type { JobPostingRow, MatchRow } from '@zentavio/db';
import { describe, expect, it } from 'vitest';

import { signal, skillFitOf, sponsorshipOf, toJobWire } from './to-wire.ts';

function posting(overrides: Partial<JobPostingRow> = {}): JobPostingRow {
  return {
    id: 'p1',
    title: 'Embedded Software Engineer',
    url: 'https://jobs.lever.co/zoox/abc',
    company_id: null,
    company_name_raw: null,
    location_raw: 'Foster City, CA',
    country_code: 'US',
    is_remote: null,
    remote_scope: null,
    posted_at: new Date('2026-08-01T00:00:00Z'),
    visa_sponsorship: 'unknown',
    visa_sponsorship_span: null,
    relocation_support: 'unknown',
    relocation_support_span: null,
    immigration_assistance: 'unknown',
    immigration_assistance_span: null,
    sponsorship_extracted_version: 'sponsorship-statement@1.0.0',
    ...overrides,
  } as unknown as JobPostingRow;
}

function match(overrides: Partial<MatchRow> = {}): MatchRow {
  return {
    job_posting_id: 'p1',
    score: '0.0000',
    scorer_version: 'skill-fit-v1',
    evidence: [],
    ...overrides,
  } as unknown as MatchRow;
}

describe('Skill Fit, and the zero that is not unknown', () => {
  it('reports a computed zero as scored, because checked-with-no-overlap is an answer', () => {
    // The exact case all six matches in the dev database are, and the one a naive UI renders as
    // "0% match" and gets wrong.
    const fit = skillFitOf(match({ score: '0.0000' }));

    expect(fit.status).toBe('scored');
    expect(fit.status === 'scored' && fit.score).toBe(0);
  });

  it('reports a missing match as unscored, and says nobody looked', () => {
    expect(skillFitOf(undefined)).toEqual({ status: 'unscored', reason: 'not-computed' });
  });

  it('separates "no requirements to score" from "not computed"', () => {
    // `ck_matches__score_iff_scored` keeps these apart in the database; losing the distinction on
    // the wire would make an uninformative posting indistinguishable from an unexamined one.
    expect(skillFitOf(match({ score: null }))).toEqual({
      status: 'unscored',
      reason: 'no-requirements',
    });
  });

  it('carries the scorer version and the evidence that produced the number', () => {
    const fit = skillFitOf(
      match({
        score: '0.6000',
        evidence: [{ skillSlug: 'go', basis: 'claimed', contribution: 0.6 }] as unknown as MatchRow['evidence'],
      }),
    );

    expect(fit.status === 'scored' && fit.scorerVersion).toBe('skill-fit-v1');
    expect(fit.status === 'scored' && fit.evidence[0]?.skillSlug).toBe('go');
  });

  it('never calls it a job match score', () => {
    // ADR-0037, asserted rather than trusted: a rename would pass typecheck and change what the
    // product claims to measure.
    const fit = skillFitOf(match());
    expect(fit.status === 'scored' && fit.scorerVersion.startsWith('job-match')).toBe(false);
  });
});

describe('sponsorship stays three signals', () => {
  it('passes the four-valued status through without mapping it onto a boolean', () => {
    const signals = sponsorshipOf(
      posting({
        visa_sponsorship: 'stated_unavailable',
        visa_sponsorship_span: 'We do not offer visa sponsorship for this position.',
        relocation_support: 'stated_available',
        relocation_support_span: 'Relocation assistance is provided.',
      }),
    );

    expect(signals.visaSponsorship.status).toBe('stated_unavailable');
    expect(signals.relocationSupport.status).toBe('stated_available');
    // Unknown is its own answer, and it is not "no".
    expect(signals.immigrationAssistance.status).toBe('unknown');
  });

  it('returns the span only for a stated status', () => {
    // Mirrors `ck_job_postings__sponsorship_span`. A span on an `unknown` row would be a quotation
    // around a sentence nobody wrote.
    expect(signal('unknown', 'a leftover sentence').span).toBeNull();
    expect(signal('stated_available', 'Visa sponsorship is available.').span).toBe(
      'Visa sponsorship is available.',
    );
  });

  it('produces no merged immigration-friendly verdict', () => {
    const signals = sponsorshipOf(posting({ visa_sponsorship: 'stated_available' }));
    // Five merged signals cannot be un-merged later, so the shape must not offer one.
    expect(Object.keys(signals).sort()).toEqual([
      'extractorVersion',
      'immigrationAssistance',
      'relocationSupport',
      'visaSponsorship',
    ]);
  });
});

describe('what a posting says about itself, and what it does not', () => {
  it('keeps a silent remote flag null rather than rendering it as on-site', () => {
    // ADR-0033. `false` asserts the employer said no; `null` says nobody asked.
    expect(toJobWire(posting({ is_remote: null }), undefined, undefined).location.isRemote).toBeNull();
    expect(toJobWire(posting({ is_remote: false }), undefined, undefined).location.isRemote).toBe(false);
  });

  it('shows an unresolved employer as an absence, not an omission', () => {
    // The state of all 239 stored postings: no `company_id`, and a Lever board names no employer.
    const wire = toJobWire(posting(), undefined, undefined);

    expect(wire.employer).toEqual({ companyId: null, name: null, nameRaw: null });
  });

  it('attributes the posting to the sighting that described it', () => {
    const wire = toJobWire(posting(), undefined, { source_id: 'lever', source_scope: 'zoox' });

    expect(wire.source).toEqual({ id: 'lever', scope: 'zoox' });
  });
});
