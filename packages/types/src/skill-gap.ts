/**
 * The wire contract between the gateway and `ai/skill-gap` (ADR-0003).
 *
 * Same arrangement as `resume-parser.ts`, for the same reason: neither side hand-writes the other's
 * types, and until schema generation exists this hand-written pair plus a runtime guard is the
 * interim contract. `snake_case` fields because the Python side speaks it and translating at the
 * boundary is a bug factory — a renamed field reads `undefined` and stores wrong data without ever
 * throwing.
 */

/**
 * Three genuinely different answers.
 *
 * `unknown` is **not** an error: it means nobody has modelled this target, which is a result the
 * user must be shown rather than a failure to retry. `no_gap` means they meet every modelled
 * requirement — also a real answer, and one the UI must state plainly instead of rendering an empty
 * list that looks like a loading bug.
 */
export type GapStatus = 'ok' | 'no_gap' | 'unknown';

export type GapCluster = 'core' | 'supporting' | 'differentiating' | 'peripheral';

export interface GapItemWire {
  readonly skill_id: string;
  /** Importance from knowledge. `null` when the requirement is known but its weight is not. */
  readonly weight: number | null;
  readonly cluster: GapCluster;
  /** 1-based position in dependency order. */
  readonly position: number;
  /** 0..1 when a held skill partly covers this one. Never closes the gap. */
  readonly partial: number | null;
  /** Which held skill produced `partial`, so the claim is checkable. */
  readonly partial_from: string | null;
  /** Gap items that must come first. */
  readonly prerequisites: readonly string[];
  readonly basis: string;
  readonly support: number | null;
}

export interface GapHeldWire {
  readonly skill_id: string;
  readonly status: string;
}

export interface GapResponseWire {
  readonly status: GapStatus;
  readonly target_id: string;
  readonly target_kind: string;
  readonly items: readonly GapItemWire[];
  readonly held: readonly GapHeldWire[];
  readonly confidence: 'high' | 'medium' | 'low';
  /** What would have made this answer better, in words a user can act on. */
  readonly missing: readonly string[];
  /** Requirements whose importance is unknown — listed, never defaulted. */
  readonly unweighted: readonly string[];
  readonly reason: string | null;
  /** Which scorer produced this. Stored with any number derived from it. */
  readonly scorer_version: string;
  readonly knowledge_as_of: string | null;
}

export interface GapRequestWire {
  readonly target_id: string;
  readonly target_kind: 'career';
  readonly requirements: ReadonlyArray<{
    readonly skill_id: string;
    readonly weight: number | null;
    readonly cluster: GapCluster;
    readonly market_scope: string | null;
    readonly basis: string;
    readonly support: number | null;
  }>;
  readonly held: ReadonlyArray<{
    readonly skill_id: string;
    readonly status: 'evidenced' | 'claimed';
    readonly confidence: 'high' | 'medium' | 'low';
  }>;
  readonly edges: ReadonlyArray<{
    readonly from_skill_id: string;
    readonly to_skill_id: string;
    readonly edge_type: string;
    readonly weight: number;
    readonly source_url: string | null;
    readonly source_tier: number;
  }>;
  readonly market: string | null;
  readonly knowledge_as_of: string | null;
  readonly unresolved: readonly string[];
}

const GAP_STATUSES = new Set<string>(['ok', 'no_gap', 'unknown']);
const CLUSTERS = new Set<string>(['core', 'supporting', 'differentiating', 'peripheral']);
const CONFIDENCES = new Set<string>(['high', 'medium', 'low']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isGapItem(value: unknown): value is GapItemWire {
  if (!isRecord(value)) return false;
  if (typeof value['skill_id'] !== 'string' || value['skill_id'] === '') return false;
  if (typeof value['cluster'] !== 'string' || !CLUSTERS.has(value['cluster'])) return false;
  if (typeof value['position'] !== 'number' || value['position'] < 1) return false;
  if (typeof value['basis'] !== 'string') return false;
  if (!isStringArray(value['prerequisites'])) return false;

  const weight = value['weight'];
  if (weight !== null && (typeof weight !== 'number' || weight < 0 || weight > 1)) return false;

  const partial = value['partial'];
  if (partial !== null && (typeof partial !== 'number' || partial < 0 || partial > 1)) return false;

  // A partial score with no source is a claim with no evidence, which is the one thing every
  // number in this system is not allowed to be.
  if (partial !== null && typeof value['partial_from'] !== 'string') return false;
  if (partial === null && value['partial_from'] !== null) return false;

  return true;
}

/**
 * Whether a value is a well-formed gap response.
 *
 * A type predicate rather than a cast: the wire is where TypeScript's guarantees genuinely stop,
 * and `as GapResponseWire` on a `fetch` result is a claim about a remote process.
 */
export function isGapResponse(value: unknown): value is GapResponseWire {
  if (!isRecord(value)) return false;
  if (typeof value['status'] !== 'string' || !GAP_STATUSES.has(value['status'])) return false;
  if (typeof value['target_id'] !== 'string' || value['target_id'] === '') return false;
  if (typeof value['target_kind'] !== 'string') return false;
  if (!Array.isArray(value['items']) || !value['items'].every(isGapItem)) return false;
  if (typeof value['confidence'] !== 'string' || !CONFIDENCES.has(value['confidence'])) return false;
  if (!isStringArray(value['missing'])) return false;
  if (!isStringArray(value['unweighted'])) return false;
  if (typeof value['scorer_version'] !== 'string' || value['scorer_version'] === '') return false;
  if (value['reason'] !== null && typeof value['reason'] !== 'string') return false;
  if (value['knowledge_as_of'] !== null && typeof value['knowledge_as_of'] !== 'string') {
    return false;
  }

  if (
    !Array.isArray(value['held']) ||
    !value['held'].every(
      (entry) =>
        isRecord(entry) && typeof entry['skill_id'] === 'string' && typeof entry['status'] === 'string',
    )
  ) {
    return false;
  }

  // A non-ok status with no reason leaves the UI nothing to show, which is exactly what the
  // honest-unknown rule exists to prevent.
  if (value['status'] !== 'ok' && value['reason'] === null) return false;

  // Positions must be dense and start at 1, or "step 3 of 5" is a lie.
  const positions = value['items'].map((item) => (item as GapItemWire).position);
  const expected = positions.map((_, index) => index + 1);
  if (positions.join(',') !== expected.join(',')) return false;

  return true;
}
