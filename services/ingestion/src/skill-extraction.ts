/**
 * Reading skills out of a posting, deterministically (ADR-0035).
 *
 * **The alias scan: no model, no prompt, no eval suite.** It finds only skills the graph already
 * curates, which bounds its recall and is also what makes it honest — it cannot invent a skill,
 * because it has no vocabulary beyond `skill_aliases`. ADR-0035 keeps it as the standing path when no
 * model is configured, the same shape as `ZENTAVIO_PARSER_ENRICHMENT=off`: a complete deterministic
 * result that says what it did not do.
 *
 * ## What it is allowed to claim
 *
 * A span found in the requirement lists may mark a row **required**. A span found in the description
 * may not — *"our platform runs on Kubernetes"* is a mention, and treating it as a requirement
 * produces a skill gap the person does not have and a learning path they do not need. They never see
 * the sentence, so the error is invisible to exactly the person it costs.
 *
 * Every row carries the sentence it came from. A requirement whose span cannot be shown is not
 * storable.
 *
 * ## Known limitation, recorded rather than patched
 *
 * A hyphenated compound resolves to its parts: *"Kubernetes-like orchestration"* matches Kubernetes,
 * because normalization strips punctuation. That is **the same normalization
 * `skill_aliases.normalized` is keyed on**, and `packages/db/src/seed.ts` warns that if the two ever
 * disagree, resolution misses silently and a phrase lands unmatched. Fixing precision here at the
 * cost of that agreement would trade a visible overclaim for an invisible miss. The model path
 * (ADR-0035) is where both recall and precision improve together.
 *
 * ## Pure
 *
 * Text and an alias index in, rows out. No database, no clock, no randomness — the same posting
 * yields identical rows and identical weights, which is what keeps a `matches` row re-derivable.
 */

import type { JobPostingSkillRow } from '@zentavio/db';

/** One alias, already normalized, and the skill it resolves to. */
export interface AliasEntry {
  readonly normalized: string;
  readonly skillId: string;
}

export type PostingSection = 'requirements' | 'description';

/** What a posting says, split by where it says it. */
export interface PostingText {
  readonly description: string | null;
  readonly requirementsText: string | null;
}

/** One skill this posting mentions, with the evidence for it. */
export interface ExtractedSkill {
  readonly skillId: string;
  readonly weight: number;
  readonly isRequired: boolean;
  readonly section: PostingSection;
  /** The sentence as published, never paraphrased. */
  readonly sourceSpan: string;
  /** How many sentences mentioned it, across both sections. */
  readonly mentions: number;
}

/** Bumped when the arithmetic below changes, so a stored row says which version produced it. */
export const EXTRACTOR_VERSION = 'alias-scan@1.0.0';

/**
 * Sentence-ish segmentation.
 *
 * Requirement lists arrive as one bullet per line, and prose as sentences. Splitting on both means a
 * span is the smallest unit that still reads as a claim — a whole paragraph as `source_span` would be
 * technically verbatim and useless to check against.
 */
function sentences(text: string): readonly string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((line) => line.replace(/^[-*•]\s*/, '').trim())
    .filter((line) => line !== '');
}

/**
 * The same normalization the alias table is keyed on, applied to a sentence.
 *
 * Deliberately imported in spirit rather than reimplemented differently: if these two ever disagree,
 * resolution misses silently and a posting looks like it asks for nothing.
 */
function normalizeForScan(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}+#]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Whether a normalized alias appears in a normalized sentence as whole words. */
function mentions(sentence: string, alias: string): boolean {
  if (alias === '') return false;
  // Both sides are already space-separated tokens, so padding makes this a whole-token search:
  // `go` must not match `going`, and `r` must not match every word containing one.
  return ` ${sentence} `.includes(` ${alias} `);
}

interface Hit {
  readonly section: PostingSection;
  readonly sentence: string;
}

/**
 * Weight, from where a skill is asked for and how often.
 *
 * Deterministic and deliberately coarse. A requirement counts for more than a mention; repetition
 * counts for a little; nothing counts for more than 1. This is arithmetic that can be recomputed and
 * argued with, which a model-produced number is not.
 */
export function weightFor(hits: readonly Hit[]): number {
  const required = hits.some((hit) => hit.section === 'requirements');
  const base = required ? 0.6 : 0.25;
  const repetition = Math.min(hits.length - 1, 3) * 0.05;
  return Math.min(1, Number((base + repetition).toFixed(3)));
}

/**
 * Every curated skill this posting mentions, with the sentence that mentions it.
 *
 * Aliases are matched longest-first, so `"amazon web services"` wins over `"aws"` where both resolve —
 * a shorter alias inside a longer one would otherwise produce two rows for one mention.
 */
export function extractSkills(text: PostingText, aliases: readonly AliasEntry[]): readonly ExtractedSkill[] {
  const ordered = [...aliases].sort((a, b) => b.normalized.length - a.normalized.length);
  const hits = new Map<string, Hit[]>();

  const sections: readonly (readonly [PostingSection, string | null])[] = [
    ['requirements', text.requirementsText],
    ['description', text.description],
  ];

  for (const [section, body] of sections) {
    if (body === null) continue;

    for (const sentence of sentences(body)) {
      const normalized = normalizeForScan(sentence);
      let remaining = ` ${normalized} `;

      for (const alias of ordered) {
        if (!mentions(remaining.trim(), alias.normalized)) continue;

        // Consume the matched text so a shorter alias nested in a longer one does not also fire.
        remaining = remaining.replace(` ${alias.normalized} `, ' ');

        const existing = hits.get(alias.skillId);
        if (existing === undefined) hits.set(alias.skillId, [{ section, sentence }]);
        else existing.push({ section, sentence });
      }
    }
  }

  return [...hits.entries()]
    .map(([skillId, found]) => {
      // The first hit decides the span, and the sections are scanned requirements-first, so a skill
      // asked for and also mentioned shows the sentence that asks for it.
      const first = found[0]!;
      return {
        skillId,
        weight: weightFor(found),
        isRequired: found.some((hit) => hit.section === 'requirements'),
        section: first.section,
        sourceSpan: first.sentence,
        mentions: found.length,
      };
    })
    .sort((a, b) => b.weight - a.weight || a.skillId.localeCompare(b.skillId));
}

/** The rows an extraction writes. `prompt_version` stays null: no model was involved. */
export function rowsFor(
  jobPostingId: string,
  extracted: readonly ExtractedSkill[],
  newId: () => string,
): readonly Omit<JobPostingSkillRow, 'created_at' | 'updated_at'>[] {
  return extracted.map((skill) => ({
    id: newId(),
    job_posting_id: jobPostingId,
    skill_id: skill.skillId,
    weight: String(skill.weight),
    basis: 'description-extraction' as const,
    is_required: skill.isRequired,
    section: skill.section,
    source_span: skill.sourceSpan,
    extractor_version: EXTRACTOR_VERSION,
    prompt_version: null,
  }));
}
