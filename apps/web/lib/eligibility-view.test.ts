import type { EligibilityResponseWire } from '@zentavio/types';
import { describe, expect, it } from 'vitest';

import { toEligibilityView, toFactValue } from './eligibility-view.ts';

function verdict(overrides: Partial<EligibilityResponseWire> = {}): EligibilityResponseWire {
  return {
    pathway_id: 'de.eu-blue-card',
    status: 'undetermined',
    requirements: [
      {
        requirement_id: 'de.eu-blue-card.salary-threshold.general',
        domain: 'immigration',
        imposed_by: 'destination',
        result: 'undetermined',
        authority: 'Bundesministerium des Innern',
        source_url: 'https://www.bundesanzeiger.de/x',
        effective_from: '2026-01-01',
        reason: 'no value on file for expected_gross_annual_salary_eur',
        needs_input: ['expected_gross_annual_salary_eur'],
      },
    ],
    blockers: [],
    needs_from_user: ['expected_gross_annual_salary_eur'],
    binding_domain: 'immigration',
    confidence: 'medium',
    as_of: '2026-06-01',
    disclaimer: 'Sourced official information, not legal advice.',
    notes: [],
    evaluator_version: '1.0.0',
    ...overrides,
  };
}

describe('undetermined is never rendered as a no', () => {
  it('leads with the question rather than the absence of an answer', () => {
    const view = toEligibilityView(verdict());

    expect(view.kind).toBe('verdict');
    if (view.kind !== 'verdict') return;
    expect(view.headline).toBe('One more answer and we can tell you');
    expect(view.explanation).toContain('Nothing here says no');
  });

  it('labels an unanswered rule as unanswered, not failed', () => {
    // "Failed" or "Missing" would tell someone they are ineligible when they simply have not
    // answered a question.
    const view = toEligibilityView(verdict());
    if (view.kind !== 'verdict') return;

    expect(view.requirements[0]?.label).toBe('Not answered yet');
  });

  it('offers the question in words, from the catalogue', () => {
    const view = toEligibilityView(verdict(), {
      expected_gross_annual_salary_eur: 'What gross annual salary do you expect?',
    });
    if (view.kind !== 'verdict') return;

    expect(view.questions).toEqual([
      {
        key: 'expected_gross_annual_salary_eur',
        prompt: 'What gross annual salary do you expect?',
      },
    ]);
  });

  it('falls back to the key rather than showing nothing', () => {
    const view = toEligibilityView(verdict());
    if (view.kind !== 'verdict') return;

    expect(view.questions[0]?.prompt).toBe('expected_gross_annual_salary_eur');
  });
});

describe('a decided verdict offers no questions', () => {
  it('asks nothing when the answer is met', () => {
    const view = toEligibilityView(verdict({ status: 'met', needs_from_user: [] }));
    if (view.kind !== 'verdict') return;

    expect(view.questions).toEqual([]);
    expect(view.headline).toContain('meet the requirements');
  });

  it('asks nothing when the answer is not_met, even if the evaluator listed inputs', () => {
    // Offering a question on a `not_met` implies answering it could change the outcome. It cannot
    // — the rule was evaluated and failed.
    const view = toEligibilityView(
      verdict({
        status: 'not_met',
        blockers: ['de.eu-blue-card.salary-threshold.general'],
        needs_from_user: ['expected_gross_annual_salary_eur'],
      }),
    );
    if (view.kind !== 'verdict') return;

    expect(view.questions).toEqual([]);
    expect(view.blockers).toEqual(['de.eu-blue-card.salary-threshold.general']);
  });
});

describe('unknown is neither a yes nor a no', () => {
  it('says it is a gap in our sourcing, not a judgement about the person', () => {
    const view = toEligibilityView(
      verdict({
        status: 'unknown',
        notes: ['this profession is licence-gated and no recognition rule is on file'],
      }),
    );
    if (view.kind !== 'verdict') return;

    expect(view.headline).toBe('We cannot answer this yet');
    expect(view.explanation).toContain('not a judgement about you');
    expect(view.notes[0]).toContain('licence-gated');
  });
});

describe('nothing is shown without its provenance', () => {
  it('carries the date and the disclaimer through', () => {
    const view = toEligibilityView(verdict());
    if (view.kind !== 'verdict') return;

    expect(view.asOf).toBe('2026-06-01');
    expect(view.disclaimer).toContain('not legal advice');
  });

  it('carries each rules authority and source', () => {
    const view = toEligibilityView(verdict());
    if (view.kind !== 'verdict') return;

    expect(view.requirements[0]?.authority).toBe('Bundesministerium des Innern');
    expect(view.requirements[0]?.sourceUrl).toBe('https://www.bundesanzeiger.de/x');
  });

  it('shows the basis for a decided rule and the reason for an undecided one', () => {
    const undecided = toEligibilityView(verdict());
    if (undecided.kind !== 'verdict') return;
    expect(undecided.requirements[0]?.detail).toContain('no value on file');

    const decided = toEligibilityView(
      verdict({
        status: 'met',
        requirements: [
          {
            ...verdict().requirements[0]!,
            result: 'met',
            basis: '60000 against a threshold of at least 50700',
            reason: null,
          },
        ],
      }),
    );
    if (decided.kind !== 'verdict') return;
    expect(decided.requirements[0]?.detail).toBe('60000 against a threshold of at least 50700');
  });
});

describe('toFactValue', () => {
  it('shapes a monetary answer with its currency and period', () => {
    // A bare number against a EUR threshold is a confident wrong answer, so the unit from the
    // catalogue is attached before sending.
    expect(toFactValue('expected_gross_annual_salary_eur', '60000', 'EUR/year')).toEqual({
      ok: true,
      value: { amount: 60000, currency: 'EUR', period: 'year', basis: 'gross' },
    });
  });

  it('accepts a number typed with separators', () => {
    expect(toFactValue('k', '60 000', 'EUR/year')).toMatchObject({ ok: true });
    expect(toFactValue('k', '60,000', 'EUR/year')).toMatchObject({ ok: true });
  });

  it('refuses an empty answer', () => {
    expect(toFactValue('k', '   ', 'EUR/year')).toEqual({ ok: false, message: 'Enter a value.' });
  });

  it('refuses something that is not a number where a number is required', () => {
    expect(toFactValue('k', 'about sixty thousand', 'EUR/year')).toMatchObject({ ok: false });
  });

  it('refuses zero or negative pay rather than sending it', () => {
    expect(toFactValue('k', '0', 'EUR/year')).toMatchObject({ ok: false });
    expect(toFactValue('k', '-5', 'EUR/year')).toMatchObject({ ok: false });
  });

  it('passes a unitless answer through as text', () => {
    expect(toFactValue('k', ' B2 ', null)).toEqual({ ok: true, value: 'B2' });
  });
});
