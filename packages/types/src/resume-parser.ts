/**
 * The contract with `ai/resume-parser` (ADR-0003).
 *
 * **Hand-written, and that is a known gap.** `.claude/context/tech-stack.md` requires JSON Schema as
 * the source of truth with generation to TypeScript and Pydantic, so neither side writes the other's
 * shapes. Generation tooling is a dependency needing its own ADR, and until it exists these types
 * are written by hand.
 *
 * What stops that from being a silent gap: `tests/fixtures/resume-parser/*.json` are generated **by
 * the Python service itself** (`ai/resume-parser/tests/test_contract.py`) and validated here by
 * `isParseResponse`. A change on either side fails a test in the same pull request. That is weaker
 * than generation — it proves the shapes agree today, not that they cannot diverge — but it is a
 * mechanism rather than a promise.
 *
 * The failure it prevents: a gateway that compiles perfectly, reads `response.parserVersion`, gets
 * `undefined` because the wire field is `parser_version`, and stores a profile with no parser
 * recorded. Nothing throws; the data is simply wrong.
 */

import type { Confidence, EvidenceKind } from './explained.ts';

/** Wire field names are `snake_case` — the Python service's, not TypeScript's. Do not "fix" them. */
export interface ParsedSkillWire {
  readonly slug: string;
  readonly status: 'evidenced' | 'claimed';
  /** Required by the schema when `status` is `evidenced`; `null` when `claimed`. */
  readonly evidence_kind: EvidenceKind | null;
  /** The verbatim line the claim came from. What makes it correctable. */
  readonly source_span: string;
  readonly confidence: Confidence;
}

/**
 * Every outcome a caller must handle.
 *
 * `unknown` is **not** an error: the service returns HTTP 200 with a reason, because a résumé that
 * could not be read is a result the user must be shown. A caller that treats a non-`ok` status as a
 * failure will show a spinner or a crash where it should show "this looks like a scan".
 */
export type ParseStatus = 'ok' | 'partial' | 'unknown';

export interface ParseResponseWire {
  readonly status: ParseStatus;
  readonly skills: readonly ParsedSkillWire[];
  /** Populated whenever `status` is not `ok`. Safe to show a user verbatim. */
  readonly reason: string | null;
  readonly degraded_sections: readonly string[];
  /** 0..1, or `null` when nothing could be read. Drives confidence downstream — never a score of the person. */
  readonly completeness: number | null;
  /** Which parser produced this. Stored with the profile so it can be reproduced. */
  readonly parser_version: string;
}

export interface ParseRequestWire {
  /** base64 — a résumé is binary. Decoded, parsed, and discarded within the request. */
  readonly document_base64: string;
  readonly content_type: string;
  /** The closed set. The service may only return slugs that appear here. */
  readonly skills: ReadonlyArray<{
    readonly slug: string;
    readonly name: string;
    readonly kind: string;
    readonly aliases: readonly string[];
  }>;
}

const STATUSES = new Set<string>(['ok', 'partial', 'unknown']);
const SKILL_STATUSES = new Set<string>(['evidenced', 'claimed']);
const CONFIDENCES = new Set<string>(['high', 'medium', 'low']);
const EVIDENCE_KINDS_WIRE = new Set<string>([
  'role',
  'project',
  'certification',
  'assessment',
  'artifact',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isParsedSkill(value: unknown): value is ParsedSkillWire {
  if (!isRecord(value)) return false;
  if (typeof value['slug'] !== 'string' || value['slug'] === '') return false;
  if (typeof value['status'] !== 'string' || !SKILL_STATUSES.has(value['status'])) return false;
  if (typeof value['source_span'] !== 'string') return false;
  if (typeof value['confidence'] !== 'string' || !CONFIDENCES.has(value['confidence'])) return false;

  const evidenceKind = value['evidence_kind'];
  if (evidenceKind !== null && (typeof evidenceKind !== 'string' || !EVIDENCE_KINDS_WIRE.has(evidenceKind))) {
    return false;
  }

  // The invariant that makes readiness honest, checked at the boundary as well as in the database:
  // an evidenced skill must say what evidences it (`ck_profile_skills__evidence`). A response
  // violating this would fail on insert, far from the service that produced it.
  if (value['status'] === 'evidenced' && evidenceKind === null) return false;

  return true;
}

/**
 * Whether a value is a well-formed parse response.
 *
 * A type predicate rather than a cast, because the wire is the one place TypeScript's guarantees
 * genuinely stop. `as ParseResponseWire` on a `fetch` result is a claim about a remote process.
 */
export function isParseResponse(value: unknown): value is ParseResponseWire {
  if (!isRecord(value)) return false;
  if (typeof value['status'] !== 'string' || !STATUSES.has(value['status'])) return false;
  if (!Array.isArray(value['skills']) || !value['skills'].every(isParsedSkill)) return false;
  if (value['reason'] !== null && typeof value['reason'] !== 'string') return false;
  if (
    !Array.isArray(value['degraded_sections']) ||
    !value['degraded_sections'].every((s) => typeof s === 'string')
  ) {
    return false;
  }
  if (typeof value['parser_version'] !== 'string' || value['parser_version'] === '') return false;

  const completeness = value['completeness'];
  if (completeness !== null) {
    if (typeof completeness !== 'number' || completeness < 0 || completeness > 1) return false;
  }

  // A non-ok status without a reason is the failure this catches: the UI has nothing to show and
  // falls back to a generic error, which is exactly what the honest-unknown rule exists to prevent.
  if (value['status'] !== 'ok' && value['reason'] === null) return false;

  return true;
}

/** The shared error envelope, as the parser emits it (`.claude/skills/backend-service/SKILL.md`). */
export interface ServiceErrorWire {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details: readonly unknown[];
    readonly correlationId: string;
    /** Part of the contract, not a hint. Callers branch on it. */
    readonly retryable: boolean;
  };
}

export function isServiceError(value: unknown): value is ServiceErrorWire {
  if (!isRecord(value)) return false;
  const error = value['error'];
  if (!isRecord(error)) return false;
  return (
    typeof error['code'] === 'string' &&
    error['code'] !== '' &&
    typeof error['message'] === 'string' &&
    Array.isArray(error['details']) &&
    typeof error['correlationId'] === 'string' &&
    error['correlationId'] !== '' &&
    typeof error['retryable'] === 'boolean'
  );
}
