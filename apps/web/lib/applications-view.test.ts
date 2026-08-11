import type { ApplicationWire } from '@zentavio/types';
import { describe, expect, it } from 'vitest';

import { predictionLine, toApplicationsView } from './applications-view.ts';

function application(overrides: Partial<ApplicationWire> = {}): ApplicationWire {
  return {
    id: 'app-1',
    externalRole: 'Senior Backend Engineer at Acme',
    status: 'applied',
    appliedAt: '2026-06-01T09:00:00.000Z',
    closedAt: null,
    countryCode: 'DE',
    requiredSponsorship: true,
    predictedScore: 0.15,
    scorerVersion: 'skill-gap@1.0.0',
    outcomes: [],
    ...overrides,
  };
}

describe('an empty list is its own state', () => {
  it('is empty rather than a ready list with nothing in it', () => {
    // Same rule as the gap surface's `no_gap`: an empty list reads as a loading bug, and the
    // screen has something to say here that a blank does not.
    expect(toApplicationsView([])).toEqual({ kind: 'empty' });
  });
});

describe('what we predicted is shown beside what happened', () => {
  it('carries the prediction as a percentage', () => {
    const view = toApplicationsView([application()]);
    if (view.kind !== 'ready') return;

    expect(view.applications[0]?.predicted).toBe(15);
    expect(predictionLine(view.applications[0]!)).toContain('15%');
  });

  it('says a prediction is absent rather than rendering zero', () => {
    // Somebody who applied before they had a profile has no readiness score. `0%` would be a
    // claim we never made, about them.
    const view = toApplicationsView([
      application({ predictedScore: null, scorerVersion: null }),
    ]);
    if (view.kind !== 'ready') return;

    expect(view.applications[0]?.predicted).toBeNull();
    expect(predictionLine(view.applications[0]!)).toContain('had not scored');
    expect(predictionLine(view.applications[0]!)).not.toContain('0%');
  });

  it('carries the prediction onto each outcome too', () => {
    const view = toApplicationsView([
      application({
        outcomes: [
          {
            id: 'o-1',
            kind: 'rejected',
            occurredAt: '2026-06-15T09:00:00.000Z',
            source: 'user-reported',
            confidence: 'high',
            elapsedDays: 14,
            predictedScore: 0.15,
            predictedKind: 'readiness',
            scorerVersion: 'skill-gap@1.0.0',
          },
        ],
      }),
    ]);
    if (view.kind !== 'ready') return;

    expect(view.applications[0]?.outcomes[0]?.predicted).toBe(15);
    expect(view.applications[0]?.outcomes[0]?.label).toBe('Rejected');
  });
});

describe('elapsed time reads as time, not as a number', () => {
  const withElapsed = (elapsedDays: number | null) =>
    toApplicationsView([
      application({
        outcomes: [
          {
            id: 'o-1',
            kind: 'interviewed',
            occurredAt: '2026-06-15T09:00:00.000Z',
            source: 'user-reported',
            confidence: 'high',
            elapsedDays,
            predictedScore: null,
            predictedKind: null,
            scorerVersion: null,
          },
        ],
      }),
    ]);

  it('names the span in days', () => {
    const view = withElapsed(14);
    if (view.kind !== 'ready') return;
    expect(view.applications[0]?.outcomes[0]?.elapsed).toBe('14 days after applying');
  });

  it('says "the same day" rather than "0 days"', () => {
    // Zero is a real answer here and reads badly as a number.
    const view = withElapsed(0);
    if (view.kind !== 'ready') return;
    expect(view.applications[0]?.outcomes[0]?.elapsed).toBe('the same day');
  });

  it('singularises one day', () => {
    const view = withElapsed(1);
    if (view.kind !== 'ready') return;
    expect(view.applications[0]?.outcomes[0]?.elapsed).toBe('1 day after applying');
  });

  it('says nothing at all when the span is unknown', () => {
    const view = withElapsed(null);
    if (view.kind !== 'ready') return;
    expect(view.applications[0]?.outcomes[0]?.elapsed).toBeNull();
  });
});

describe('what can be recorded depends on where the application stands', () => {
  it('offers the next stages, and rejection at every open one', () => {
    // Rejection is the most common outcome and the one people are least inclined to come back and
    // record, so it is never more than one tap away while the application is open.
    for (const status of ['applied', 'screening', 'interviewing', 'offered'] as const) {
      const view = toApplicationsView([application({ status })]);
      if (view.kind !== 'ready') continue;

      const kinds = view.applications[0]?.canRecord.map((choice) => choice.kind) ?? [];
      expect(kinds, status).toContain('rejected');
    }
  });

  it('offers nothing once the application is closed', () => {
    for (const status of ['accepted', 'rejected', 'withdrawn', 'expired'] as const) {
      const view = toApplicationsView([application({ status })]);
      if (view.kind !== 'ready') continue;

      expect(view.applications[0]?.canRecord, status).toEqual([]);
    }
  });

  it('never offers an outcome that is about the person rather than the application', () => {
    // `relocated`, `course_completed` and `assessment_passed` are real kinds, and forcing them
    // onto an application's timeline would make its status mean two things.
    const view = toApplicationsView([application()]);
    if (view.kind !== 'ready') return;

    const kinds = view.applications[0]?.canRecord.map((choice) => choice.kind) ?? [];
    expect(kinds).not.toContain('relocated');
    expect(kinds).not.toContain('course_completed');
    expect(kinds).not.toContain('assessment_passed');
  });

  it('labels every choice in words rather than as a column value', () => {
    const view = toApplicationsView([application()]);
    if (view.kind !== 'ready') return;

    for (const choice of view.applications[0]?.canRecord ?? []) {
      expect(choice.label).not.toBe(choice.kind);
    }
  });
});

describe('a status is never rendered bare', () => {
  it('says what the stage means', () => {
    const view = toApplicationsView([application({ status: 'applied' })]);
    if (view.kind !== 'ready') return;

    expect(view.applications[0]?.statusLabel).toBe('Applied — no news yet');
  });

  it('falls back to the value rather than showing nothing for an unknown status', () => {
    const view = toApplicationsView([
      application({ status: 'unheard_of' as ApplicationWire['status'] }),
    ]);
    if (view.kind !== 'ready') return;

    expect(view.applications[0]?.statusLabel).toBe('unheard_of');
  });
});
