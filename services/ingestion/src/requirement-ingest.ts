/**
 * Turning connector output into stored requirements.
 *
 * **Persistence lives here, never in a connector** (`docs/architecture/connectors.md:140`,
 * ADR-0021's rollout plan). A connector fetches, validates its own payload, and returns data; a
 * connector that wrote to the database would stop being a plugin and become a pipeline wearing a
 * plugin's interface, which is the property ADR-0002 exists to protect and M3 exists to test.
 *
 * **No source is named here.** This module iterates the registry (ADR-0002). Adding Luxembourg must
 * not require editing this file, and if it ever does, the plugin claim is false.
 *
 * ## Planning is separated from writing, deliberately
 *
 * `planIngest` is pure: connector output in, a list of decisions out. Nothing it returns has
 * touched the database. That is what makes the interesting behaviour — supersession, idempotence,
 * rejection — testable without PostgreSQL, and what lets a caller show an operator what *would*
 * happen before it happens.
 */

import { isIngestible, type AnyConnector } from '@zentavio/connectors-core';
import type { NewRequirement } from '@zentavio/db';
import type { SourcedRequirement, ValidationIssue } from '@zentavio/types';

/** What should happen to one requirement the connector produced. */
export type IngestAction =
  /** No row with this `requirement_id` exists. Insert it. */
  | 'insert'
  /** A current row exists at a different version. Close it and insert this one. */
  | 'supersede'
  /** This exact `(requirement_id, version)` is already stored. Do nothing. */
  | 'unchanged'
  /** The connector's own validation rejected it, or it cannot be mapped. Do not store it. */
  | 'reject';

export interface IngestDecision {
  readonly requirementId: string;
  readonly action: IngestAction;
  readonly row?: NewRequirement;
  /** The row this one closes, when the action is `supersede`. */
  readonly supersedes?: { readonly id: string; readonly closeOn: string };
  /** Why, when the action is `reject`. Never a bare failure. */
  readonly issues?: readonly ValidationIssue[];
}

/** What is already stored, so planning can decide insert vs supersede vs unchanged. */
export interface ExistingRequirement {
  readonly id: string;
  readonly requirementId: string;
  readonly version: string;
  /** Null while current. */
  readonly effectiveTo: string | null;
}

export interface IngestPlan {
  readonly sourceId: string;
  readonly decisions: readonly IngestDecision[];
}

/**
 * Map a connector's normalized requirement onto the row shape the repository accepts.
 *
 * `id` is deliberately absent: the caller supplies a UUIDv7 at write time. Generating it here
 * would make `planIngest` impure and every golden-file test unstable.
 */
export function toRow(requirement: SourcedRequirement, id: string): NewRequirement {
  return {
    id,
    requirement_id: requirement.requirementId,
    domain: requirement.domain,
    imposed_by: requirement.imposedBy,
    jurisdiction: requirement.jurisdiction,
    subdivision: requirement.subdivision ?? null,
    pathway_id: requirement.pathwayId,
    profession: requirement.profession,
    kind: requirement.kind,
    value: JSON.stringify(requirement.value),
    applies_to: JSON.stringify(requirement.appliesTo),
    domain_detail: JSON.stringify(requirement.domainDetail),
    evaluation: requirement.evaluation,
    needs_input: [...requirement.needsInput],
    source_tier: requirement.sourceTier,
    source_url: requirement.sourceUrl,
    source_document: requirement.sourceDocument,
    retrieved_at: requirement.retrievedAt,
    authority: requirement.authority,
    authority_url: requirement.authorityUrl ?? null,
    effective_from: requirement.effectiveFrom,
    effective_to: requirement.effectiveTo,
    version: requirement.version,
    contested: requirement.contested,
    contested_note: requirement.contestedNote ?? null,
    refresh_after: requirement.refreshAfter,
  };
}

/**
 * Decide what to do with each requirement, given what is already stored.
 *
 * Pure. Takes the ids it will use rather than generating them, so the same inputs always produce
 * the same plan.
 *
 * The supersession rule is the one that matters. A new version of a threshold **closes** the
 * previous row rather than replacing its value: a person planned against the old number, and
 * "the threshold you were planning against changed on 2026-01-01" is only sayable if the old row
 * still exists (`docs/architecture/immigration.md`, Versioning).
 */
export function planIngest(
  connector: AnyConnector,
  normalized: readonly SourcedRequirement[],
  existing: readonly ExistingRequirement[],
  idsFor: (requirementId: string) => string,
): IngestPlan {
  const currentByRequirementId = new Map(
    existing.filter((row) => row.effectiveTo === null).map((row) => [row.requirementId, row]),
  );
  const storedVersions = new Set(existing.map((row) => `${row.requirementId}@${row.version}`));

  const decisions: IngestDecision[] = [];

  for (const requirement of normalized) {
    // The connector's own validation runs first and is authoritative about its payload. A rejected
    // record is reported with its reasons, never stored and never silently dropped.
    const result = connector.validate([requirement]);
    if (!isIngestible(result)) {
      decisions.push({
        requirementId: requirement.requirementId,
        action: 'reject',
        issues: result.issues,
      });
      continue;
    }

    if (storedVersions.has(`${requirement.requirementId}@${requirement.version}`)) {
      decisions.push({ requirementId: requirement.requirementId, action: 'unchanged' });
      continue;
    }

    const row = toRow(requirement, idsFor(requirement.requirementId));
    const current = currentByRequirementId.get(requirement.requirementId);

    if (current === undefined) {
      decisions.push({ requirementId: requirement.requirementId, action: 'insert', row });
      continue;
    }

    // Close the previous row the day before the new one takes effect. Closing it *on* the new
    // effective date would leave both live for one day, and `uq_req__current` would reject the
    // insert — correctly, because two live rows make evaluation non-deterministic.
    decisions.push({
      requirementId: requirement.requirementId,
      action: 'supersede',
      row: { ...row, supersedes: current.id },
      supersedes: { id: current.id, closeOn: dayBefore(requirement.effectiveFrom) },
    });
  }

  return { sourceId: connector.meta.id, decisions };
}

/**
 * The day before an ISO date.
 *
 * Uses UTC arithmetic rather than string slicing, so a new year, a leap day, and a month boundary
 * are all the same case. A threshold effective 2027-01-01 closes its predecessor on 2026-12-31,
 * and getting that wrong by a day means either a gap with no live rule or an overlap the unique
 * index refuses.
 */
export function dayBefore(isoDate: string): string {
  const at = new Date(`${isoDate}T00:00:00.000Z`);
  at.setUTCDate(at.getUTCDate() - 1);
  return at.toISOString().slice(0, 10);
}

export interface IngestSummary {
  readonly sourceId: string;
  readonly inserted: number;
  readonly superseded: number;
  readonly unchanged: number;
  readonly rejected: number;
}

/** Count a plan without executing it — what `--dry-run` reports, and what a run logs afterwards. */
export function summarize(plan: IngestPlan): IngestSummary {
  const count = (action: IngestAction) => plan.decisions.filter((d) => d.action === action).length;
  return {
    sourceId: plan.sourceId,
    inserted: count('insert'),
    superseded: count('supersede'),
    unchanged: count('unchanged'),
    rejected: count('reject'),
  };
}
