import type { EligibilityResponseWire } from '@zentavio/types';
import { describe, expect, it } from 'vitest';

import {
  toEligibilityView,
  toFactValue,
  toViabilityView,
  type ViabilityWire,
} from './eligibility-view.ts';

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

describe('the ways in are rendered as routes, not flattened (ADR-0024)', () => {
  /** § 18g as it evaluates for a degree holder in an unlisted occupation. */
  function routed(): EligibilityResponseWire {
    return verdict({
      status: 'met',
      needs_from_user: [],
      route: 'abs1-s1',
      routes: [
        {
          route: 'abs1-s1',
          status: 'met',
          blockers: [],
          needs_from_user: [],
          requirement_ids: ['de.eu-blue-card.salary-threshold.general', 'de.eu-blue-card.qualification'],
        },
        {
          route: 'abs1-s2',
          status: 'undetermined',
          blockers: [],
          needs_from_user: ['years_since_degree_awarded'],
          requirement_ids: ['de.eu-blue-card.salary-threshold.reduced'],
        },
        {
          route: 'abs2',
          status: 'not_applicable',
          blockers: [],
          needs_from_user: [],
          requirement_ids: ['de.eu-blue-card.professional-experience'],
          reason: 'no qualifying circumstance applies: de.eu-blue-card.experience-route-occupations',
        },
      ],
    });
  }

  it('keeps every route, including the ones that do not apply', () => {
    // Dropping the closed ones would leave the verdict unexplainable: "met by abs1-s1" means
    // nothing if the reader cannot see what the alternatives were.
    const view = toEligibilityView(routed());
    if (view.kind !== 'verdict') return;

    expect(view.routes.map((route) => route.route)).toEqual(['abs1-s1', 'abs1-s2', 'abs2']);
    expect(view.routes.map((route) => route.status)).toEqual(['met', 'undetermined', 'not_applicable']);
  });

  it('names the route the verdict used', () => {
    const view = toEligibilityView(routed());
    if (view.kind !== 'verdict') return;

    expect(view.usedRoute).toBe('abs1-s1');
    expect(view.routes.filter((route) => route.used).map((route) => route.route)).toEqual(['abs1-s1']);
  });

  it('never words a closed route as a failure', () => {
    // "You failed the experience route" is a false statement about someone who holds a degree.
    // They were never on it.
    const view = toEligibilityView(routed());
    if (view.kind !== 'verdict') return;

    const closed = view.routes.find((route) => route.route === 'abs2');
    expect(closed?.label).toBe('Not a way in for you');
    expect(closed?.label.toLowerCase()).not.toContain('fail');
    expect(closed?.label.toLowerCase()).not.toContain('not met');
    expect(closed?.detail).toContain('no qualifying circumstance applies');
  });

  it('carries each open routes own questions, in words', () => {
    // The product leads with the shortest set of questions; it does not get to hide that another
    // way in exists and has its own (ADR-0024 rule 5).
    const view = toEligibilityView(routed(), {
      years_since_degree_awarded: 'How many years ago was your degree awarded?',
    });
    if (view.kind !== 'verdict') return;

    const reduced = view.routes.find((route) => route.route === 'abs1-s2');
    expect(reduced?.questions).toEqual([
      {
        key: 'years_since_degree_awarded',
        prompt: 'How many years ago was your degree awarded?',
      },
    ]);
    // The verdict itself is `met` and asks nothing. The route still says what would move it.
    expect(view.questions).toEqual([]);
  });

  it('shows which rules were checked on which route', () => {
    const view = toEligibilityView(routed());
    if (view.kind !== 'verdict') return;

    expect(view.routes[0]?.requirementIds).toContain('de.eu-blue-card.qualification');
    expect(view.routes[2]?.requirementIds).not.toContain('de.eu-blue-card.qualification');
  });

  it('renders no route structure for a pathway that declares none', () => {
    // Every pathway starts here, and inventing a "default route" heading would be the screen
    // asserting a model the data does not have.
    const view = toEligibilityView(verdict());
    if (view.kind !== 'verdict') return;

    expect(view.routes).toEqual([]);
    expect(view.usedRoute).toBeNull();
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

describe('the headline is driven by the binding constraint, not the verdict', () => {
  function wire(overrides: Partial<ViabilityWire> = {}): ViabilityWire {
    return {
      binding: 'employability',
      binding_reason: 'You meet the requirements, and 27 skill(s) still stand between you and the work.',
      eligibility: verdict({ status: 'met', needs_from_user: [] }),
      employability: { score_low: 0.129, score_high: 0.164, missing_count: 27 },
      as_of: '2026-06-01',
      disclaimer: 'Sourced official information, not legal advice.',
      ...overrides,
    };
  }

  it('does not say "you meet the requirements" when readiness is what binds', () => {
    // The exact misleading output ADR-0022 removed: `met` at 13% readiness and `met` at 91% are
    // the same verdict and completely different situations.
    const view = toViabilityView(wire());
    if (view.kind !== 'viability') return;

    expect(view.eligibility.status).toBe('met');
    expect(view.headline).toBe('You qualify — the gap is readiness, not the rules');
    expect(view.headline).not.toContain('meet the requirements we can check');
  });

  it('says it is worth pursuing only when nothing binds', () => {
    const view = toViabilityView(
      wire({ binding: 'none', employability: { score_low: 0.91, score_high: 0.94, missing_count: 0 } }),
    );
    if (view.kind !== 'viability') return;
    expect(view.headline).toBe('This looks worth pursuing');
  });

  it('gives recognition and unsourced coverage different sentences', () => {
    // One is about the person's profession, the other about our gaps. Collapsing them tells a
    // nurse we have no rules when what we mean is her licence may not transfer.
    const recognition = toViabilityView(wire({ binding: 'recognition' }));
    const unmodelled = toViabilityView(wire({ binding: 'unmodelled' }));
    if (recognition.kind !== 'viability' || unmodelled.kind !== 'viability') return;

    expect(recognition.headline).not.toBe(unmodelled.headline);
    expect(recognition.headline).toContain('recognition');
  });

  it('carries the band as a range, never a single figure', () => {
    const view = toViabilityView(wire());
    if (view.kind !== 'viability') return;

    expect(view.readiness).toEqual({ low: 13, high: 16, missing: 27 });
  });

  it('has no readiness when it could not be scored', () => {
    const view = toViabilityView(
      wire({ employability: { score_low: null, score_high: null, missing_count: 0 } }),
    );
    if (view.kind !== 'viability') return;
    expect(view.readiness).toBeNull();
  });

  it('still offers the resolving question when eligibility binds', () => {
    const view = toViabilityView(wire({ binding: 'eligibility', eligibility: verdict() }));
    if (view.kind !== 'viability') return;

    expect(view.binding).toBe('eligibility');
    expect(view.questions.map((q) => q.key)).toEqual(['expected_gross_annual_salary_eur']);
  });

  it('carries the date and the disclaimer', () => {
    const view = toViabilityView(wire());
    if (view.kind !== 'viability') return;
    expect(view.asOf).toBe('2026-06-01');
    expect(view.disclaimer).toContain('not legal advice');
  });
});
