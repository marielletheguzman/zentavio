/**
 * What a person attempted, and what came of it (ADR-0019).
 *
 * **camelCase, unlike the eligibility and gap shapes.** Those are `snake_case` because a Python
 * service emits them and renaming across the boundary would mean two names for one field with a
 * translation nobody tests. These are the gateway's own, mapped from database columns, and the
 * gateway speaks the language its callers do.
 *
 * The field worth explaining is `predictedScore`. It is on the wire because a person is entitled
 * to see what this product predicted about them **before** they applied, next to what actually
 * happened. That is what makes a score falsifiable rather than decorative, and it is a property
 * very few career products have.
 */

/** `ck_outcomes__kind`'s closed set. */
export type OutcomeKind =
  | 'applied'
  | 'screened'
  | 'interviewed'
  | 'offered'
  | 'rejected'
  | 'withdrawn'
  | 'accepted'
  | 'started'
  | 'relocated'
  | 'course_completed'
  | 'assessment_passed';

/** `ck_applications__status`'s closed set — the *current* stage, not the history. */
export type ApplicationStatus =
  | 'saved'
  | 'applied'
  | 'screening'
  | 'interviewing'
  | 'offered'
  | 'accepted'
  | 'rejected'
  | 'withdrawn'
  | 'expired';

export interface OutcomeWire {
  readonly id: string;
  readonly kind: OutcomeKind;
  readonly occurredAt: string;
  /** How we know: a reported rejection and an inferred one are different evidence. */
  readonly source: 'user-reported' | 'inferred' | 'platform-observed';
  readonly confidence: string;
  /** Whole days from the application. Null when either end is unknown — never zero as a stand-in. */
  readonly elapsedDays: number | null;
  /** What we predicted before this happened. Null when nothing had been scored yet. */
  readonly predictedScore: number | null;
  readonly predictedKind: string | null;
  /** Which code produced the prediction. A score with no scorer cannot be calibrated. */
  readonly scorerVersion: string | null;
}

export interface ApplicationWire {
  readonly id: string;
  /** The role as the person described it. Null only for rows created from a posting (M4). */
  readonly externalRole: string | null;
  readonly status: ApplicationStatus;
  readonly appliedAt: string | null;
  readonly closedAt: string | null;
  readonly countryCode: string | null;
  readonly requiredSponsorship: boolean;
  readonly predictedScore: number | null;
  readonly scorerVersion: string | null;
  /** The timeline, oldest first. Empty is normal: an application with no news yet. */
  readonly outcomes: readonly OutcomeWire[];
}
