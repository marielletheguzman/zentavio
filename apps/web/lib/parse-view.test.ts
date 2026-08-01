/**
 * The five states, asserted rather than clicked.
 *
 * `.claude/context/ui-guidelines.md` requires all states designed before the success state is
 * styled. Testing them here is what makes that true rather than aspirational — a state that only
 * exists inside JSX is a state nobody checks until a user finds it.
 */

import { describe, expect, it } from 'vitest';
import type { ParseResponseWire } from '@zentavio/types';
import {
  applyCorrectionToView,
  evidencedCount,
  summaryFor,
  viewStateFor,
  type CorrectionBody,
  type UploadBody,
} from './parse-view.ts';

function response(overrides: Partial<ParseResponseWire> = {}): ParseResponseWire {
  return {
    status: 'ok',
    skills: [
      {
        slug: 'kubernetes',
        status: 'claimed',
        evidence_kind: null,
        source_span: 'Kubernetes',
        confidence: 'medium',
      },
      {
        slug: 'go',
        status: 'evidenced',
        evidence_kind: 'role',
        source_span: 'Ran Go services in production',
        confidence: 'high',
      },
    ],
    reason: null,
    degraded_sections: [],
    completeness: 0.3,
    parser_version: 'resume-parser/test',
    ...overrides,
  };
}

const body = (parse: ParseResponseWire, stored = true): UploadBody => ({ stored, parse });

describe('viewStateFor', () => {
  it('maps a clean parse to success', () => {
    const state = viewStateFor(body(response()));
    expect(state.kind).toBe('success');
    if (state.kind !== 'success') return;
    expect(state.skills).toHaveLength(2);
    expect(state.stored).toBe(true);
  });

  it('treats unknown as its own state, never an empty success', () => {
    // The failure this prevents: an empty cell or a zero where the honest answer is "we could not
    // read this".
    const state = viewStateFor(
      body(response({ status: 'unknown', skills: [], reason: 'This looks like a scan.' }), false),
    );

    expect(state.kind).toBe('unknown');
    if (state.kind !== 'unknown') return;
    expect(state.reason).toBe('This looks like a scan.');
  });

  it('keeps a partial result usable and names what was missed', () => {
    const state = viewStateFor(
      body(response({ status: 'partial', reason: 'A table could not be read cleanly.' })),
    );

    expect(state.kind).toBe('partial');
    if (state.kind !== 'partial') return;
    // Partial shows what loaded — the page stays usable rather than collapsing to an error.
    expect(state.skills).toHaveLength(2);
    expect(state.reason).toContain('table');
  });

  it('degrades to a stated reason if the contract ever breaks', () => {
    // The validator rejects a non-ok status with no reason, so this is unreachable through the
    // real service — but a vague message beats an empty panel if it ever happens.
    const state = viewStateFor(body(response({ status: 'unknown', skills: [], reason: null })));
    expect(state.kind).toBe('unknown');
    if (state.kind !== 'unknown') return;
    expect(state.reason.length).toBeGreaterThan(0);
  });

  it('reports stored separately from parsed', () => {
    // A readable résumé with nothing recognised is a successful parse that stores nothing, and the
    // user is owed both facts.
    const state = viewStateFor(body(response({ status: 'partial', skills: [], reason: 'x' }), false));
    expect(state.kind).toBe('partial');
    if (state.kind !== 'partial') return;
    expect(state.stored).toBe(false);
  });
});

describe('confidence rendering', () => {
  it('gives every skill a confidence label in words', () => {
    // Nothing may be conveyed by colour alone (`ui-guidelines.md`), so the difference has to carry
    // in text a screen reader reaches.
    const state = viewStateFor(body(response()));
    if (state.kind !== 'success') throw new Error('expected success');

    for (const skill of state.skills) {
      expect(skill.confidenceLabel.length).toBeGreaterThan(0);
    }
  });

  it('labels low confidence distinctly rather than as a quieter high', () => {
    const state = viewStateFor(
      body(response({ skills: [{ ...response().skills[0]!, confidence: 'low' }] })),
    );
    if (state.kind !== 'success') throw new Error('expected success');
    expect(state.skills[0]?.confidenceLabel).toBe('Low confidence');
  });
});

describe('evidence', () => {
  it('carries the verbatim span for every claim', () => {
    // A claim whose basis the user cannot see is not correctable, which is the whole point.
    const state = viewStateFor(body(response()));
    if (state.kind !== 'success') throw new Error('expected success');

    for (const skill of state.skills) {
      expect(skill.sourceSpan.length).toBeGreaterThan(0);
    }
  });

  it('distinguishes evidenced from claimed', () => {
    const state = viewStateFor(body(response()));
    if (state.kind !== 'success') throw new Error('expected success');
    expect(evidencedCount(state.skills)).toBe(1);
  });
});

describe('summaryFor', () => {
  it('says what the number is made of rather than giving a bare count', () => {
    // "12 skills" invites reading a résumé as a score. The split is the honest summary.
    expect(summaryFor(viewSkills())).toBe('1 used in described work, 1 listed only');
  });

  it('is explicit that nothing was invented when nothing matched', () => {
    expect(summaryFor([])).toContain('invented');
  });

  it('omits a zero half rather than printing "0 listed only"', () => {
    const onlyEvidenced = viewSkills().filter((s) => s.evidenced);
    expect(summaryFor(onlyEvidenced)).toBe('1 used in described work');
  });
});

function viewSkills() {
  const state = viewStateFor(body(response()));
  if (state.kind !== 'success') throw new Error('expected success');
  return state.skills;
}

describe('applyCorrectionToView', () => {
  const corrected: CorrectionBody = {
    version: 2,
    skills: [
      {
        slug: 'terraform',
        status: 'claimed',
        evidenceKind: null,
        sourceSpan: 'Wrote Go services and Terraform modules',
        confidence: 'high',
        selfReported: true,
      },
      {
        slug: 'go',
        status: 'evidenced',
        evidenceKind: 'role',
        sourceSpan: 'Wrote Go services and Terraform modules',
        confidence: 'high',
        selfReported: false,
      },
    ],
  };

  it('rebuilds the list from the response rather than patching a row', () => {
    // The server rewrote the whole profile version. Trusting a local edit would drift from what was
    // stored the first time the server does anything the client did not predict.
    const skills = applyCorrectionToView(corrected);
    expect(skills.map((s) => s.slug)).toEqual(['terraform', 'go']);
    expect(skills[0]?.evidenced).toBe(false);
  });

  it('marks a corrected row as the user own statement, not as a confidence level', () => {
    // "You corrected this" is a different kind of statement from "Fairly confident" — conflating
    // them would present the user's own correction as the platform's assessment.
    const skills = applyCorrectionToView(corrected);
    expect(skills[0]?.confidenceLabel).toBe('You corrected this');
    expect(skills[0]?.selfReported).toBe(true);
  });

  it('leaves an uncorrected row reading as the parser left it', () => {
    const skills = applyCorrectionToView(corrected);
    expect(skills[1]?.confidenceLabel).toBe('Confident');
    expect(skills[1]?.selfReported).toBe(false);
  });

  it('says where a self-reported claim came from when there is no span', () => {
    // An empty quote would look like missing evidence rather than the user's own statement.
    const [skill] = applyCorrectionToView({
      version: 3,
      skills: [
        {
          slug: 'kubernetes',
          status: 'evidenced',
          evidenceKind: 'role',
          sourceSpan: null,
          confidence: 'high',
          selfReported: true,
        },
      ],
    });
    expect(skill?.sourceSpan).toBe('You told us this.');
  });
});
