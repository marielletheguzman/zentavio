/**
 * `@zentavio/matching` — scores a person against a posting.
 *
 * **The number is arithmetic** (`.claude/skills/ai-matching/SKILL.md`). A model that produces a score
 * is not reproducible, not calibratable and not defensible, which is the whole product. A model may
 * write prose from computed evidence; that call lands in `ai/`, behind HTTP.
 *
 * Today this exports exactly one scorer: **Skill Fit**, one axis of the thirteen
 * `docs/features/job-matching.md` defines. It is **not** the Job Match Score and may not be renamed
 * into one — ADR-0037 says why, and the name is the limitation.
 */

export {
  SCORER_VERSION,
  scoreSkillFit,
  type EvidenceKind,
  type SkillFitEvidence,
  type SkillFitInput,
  type SkillFitResult,
  type SkillFitStatus,
} from './skill-fit.ts';

export {
  scorePostingForUser,
  type ScoringDeps,
  type ScoringOutcome,
  type ScoringRefusal,
  type ScoringRequest,
} from './scoring-run.ts';
