/**
 * Turning applications into what the screen must show.
 *
 * Pure and separate from the component, for the same reason as `gap-view.ts` and
 * `eligibility-view.ts`: every state must be designed before the success state is styled, and a
 * state that lives only in JSX is one nobody checks until a user finds it.
 *
 * Two rules this file exists to hold:
 *
 * 1. **What we predicted is shown beside what happened.** That pairing is the entire reason
 *    outcomes are recorded (ADR-0019), and hiding it would make the score unfalsifiable to the
 *    person it was about.
 * 2. **A prediction that was never made is said to be absent**, never rendered as zero. Someone
 *    who applied before they had a profile has no readiness score, and "0%" is a claim we did not
 *    make.
 */

import type { ApplicationWire, OutcomeKind, OutcomeWire } from '@zentavio/types';

/** What the person can record next, in the order an application actually moves. */
export interface OutcomeChoice {
  readonly kind: OutcomeKind;
  /** The verb as a person would say it, never the column value. */
  readonly label: string;
}

export interface OutcomeView {
  readonly id: string;
  readonly kind: OutcomeKind;
  readonly label: string;
  readonly occurredOn: string;
  /** "14 days after applying", or null when either end is unknown. */
  readonly elapsed: string | null;
  /**
   * What we had predicted, as a percentage, when the application was made.
   *
   * Null when nothing had been scored. **Not zero** — the absence of a prediction and a prediction
   * of nothing are different facts, and only one of them is ours.
   */
  readonly predicted: number | null;
}

export interface ApplicationView {
  readonly id: string;
  readonly role: string;
  readonly status: string;
  /** What the status means, in words. Never a bare column value. */
  readonly statusLabel: string;
  readonly appliedOn: string | null;
  readonly countryCode: string | null;
  readonly requiredSponsorship: boolean;
  readonly predicted: number | null;
  readonly scorerVersion: string | null;
  readonly outcomes: readonly OutcomeView[];
  /** Empty once the application is closed: nothing further happens to it. */
  readonly canRecord: readonly OutcomeChoice[];
}

export type ApplicationsViewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string; readonly retryable: boolean }
  /**
   * Nobody has recorded anything yet.
   *
   * Its own state rather than an empty list, for the same reason `no_gap` is its own state on the
   * gap surface: an empty list reads as a loading bug.
   */
  | { readonly kind: 'empty' }
  | { readonly kind: 'ready'; readonly applications: readonly ApplicationView[] };

const STATUS_LABELS: Readonly<Record<string, string>> = {
  saved: 'Saved, not applied yet',
  applied: 'Applied — no news yet',
  screening: 'In screening',
  interviewing: 'Interviewing',
  offered: 'Offered',
  accepted: 'Accepted',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  expired: 'Expired',
};

const OUTCOME_LABELS: Readonly<Record<OutcomeKind, string>> = {
  applied: 'Applied',
  screened: 'Screened',
  interviewed: 'Interviewed',
  offered: 'Offered',
  rejected: 'Rejected',
  withdrawn: 'Withdrew',
  accepted: 'Accepted',
  started: 'Started',
  relocated: 'Relocated',
  course_completed: 'Completed a course',
  assessment_passed: 'Passed an assessment',
};

/**
 * What can be recorded from here.
 *
 * **Every choice is one tap**, because outcome data is not collected if it takes a form
 * (`docs/features/outcomes-learning.md`). Rejection stays available at every open stage: it is the
 * most common outcome and the one people are least inclined to come back and type.
 */
const CHOICES_BY_STATUS: Readonly<Record<string, readonly OutcomeKind[]>> = {
  saved: ['applied', 'withdrawn'],
  applied: ['screened', 'interviewed', 'rejected', 'withdrawn'],
  screening: ['interviewed', 'offered', 'rejected', 'withdrawn'],
  interviewing: ['offered', 'rejected', 'withdrawn'],
  offered: ['accepted', 'rejected', 'withdrawn'],
  // Closed. Nothing further happens to the application itself — `relocated` and `started` are
  // things that happen to a person, and they belong to a surface this milestone does not build.
  accepted: [],
  rejected: [],
  withdrawn: [],
  expired: [],
};

function percentage(score: number | null): number | null {
  return score === null ? null : Math.round(score * 100);
}

function toOutcomeView(outcome: OutcomeWire): OutcomeView {
  return {
    id: outcome.id,
    kind: outcome.kind,
    label: OUTCOME_LABELS[outcome.kind],
    occurredOn: outcome.occurredAt.slice(0, 10),
    elapsed:
      outcome.elapsedDays === null
        ? null
        : outcome.elapsedDays === 0
          ? 'the same day'
          : `${String(outcome.elapsedDays)} day${outcome.elapsedDays === 1 ? '' : 's'} after applying`,
    predicted: percentage(outcome.predictedScore),
  };
}

export function toApplicationsView(
  applications: readonly ApplicationWire[],
): ApplicationsViewState {
  if (applications.length === 0) return { kind: 'empty' };

  return {
    kind: 'ready',
    applications: applications.map((application) => ({
      id: application.id,
      // The role is free text the person typed. Null only for rows created from a posting (M4),
      // and a blank line there would read as a rendering fault.
      role: application.externalRole ?? 'Untitled role',
      status: application.status,
      statusLabel: STATUS_LABELS[application.status] ?? application.status,
      appliedOn: application.appliedAt === null ? null : application.appliedAt.slice(0, 10),
      countryCode: application.countryCode,
      requiredSponsorship: application.requiredSponsorship,
      predicted: percentage(application.predictedScore),
      scorerVersion: application.scorerVersion,
      outcomes: application.outcomes.map(toOutcomeView),
      canRecord: (CHOICES_BY_STATUS[application.status] ?? []).map((kind) => ({
        kind,
        label: OUTCOME_LABELS[kind],
      })),
    })),
  };
}

/**
 * What to say about a prediction, or about its absence.
 *
 * The absence is worth a sentence rather than a blank: it tells the person *why* there is no
 * number, which is a fact about our coverage rather than about them.
 */
export function predictionLine(view: ApplicationView): string {
  if (view.predicted === null) {
    return 'We had not scored your readiness when you recorded this, so there is nothing to check this against.';
  }

  return `We put your readiness at ${String(view.predicted)}% when you applied. What happened next is what tells us whether that meant anything.`;
}
