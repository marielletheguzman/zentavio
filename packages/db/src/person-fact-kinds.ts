/**
 * The catalogue of facts a requirement may ask a person for.
 *
 * **Platform reference data, not country data.** It lives here rather than in `seeds/` because
 * `seeds/` holds sourced knowledge with a provenance tier — a career track's skill graph, curated
 * at tier 3. A fact kind has no source and no tier: it is the shape of a question, closer to an
 * enum than to knowledge, and giving it a fabricated `source_tier` would be a provenance lie of
 * exactly the kind `seeds/README.md` warns about.
 *
 * ## The invariant this exists to hold
 *
 * Every value in a `requirements.needs_input` array must have a row here. A rule asking for a key
 * the catalogue does not define produces a `needsFromUser` nobody can answer, and the verdict then
 * stays `undetermined` forever with no action available to the user — which is the exact failure
 * M2's milestone test is written to catch.
 *
 * ## Adding one
 *
 * Add the row, then the UI that asks for it. A key here with no way to answer it is worse than no
 * key at all: it makes the product promise a resolution it cannot accept.
 */

export interface PersonFactKindSeed {
  readonly key: string;
  readonly valueType: 'monetary' | 'integer' | 'decimal' | 'boolean' | 'string' | 'enum' | 'date';
  readonly unit: string | null;
  readonly prompt: string;
  readonly rationale: string;
  readonly sensitive: boolean;
  readonly allowedValues: readonly string[];
}

/**
 * Deliberately short. Each entry is a question a real ingested rule asks today, and nothing is
 * added in anticipation — a catalogue entry with no rule behind it is a question we cannot justify
 * asking, and `rationale` is where that justification has to be written down.
 */
export const PERSON_FACT_KINDS: readonly PersonFactKindSeed[] = [
  {
    key: 'expected_gross_annual_salary_eur',
    valueType: 'monetary',
    unit: 'EUR/year',
    prompt: 'What gross annual salary do you expect, in euros?',
    rationale:
      'The EU Blue Card salary minimum is compared against gross annual pay. Germany publishes ' +
      'two thresholds, so this decides which one applies to you and whether you clear it.',
    // Pay is among the most sensitive things a person tells a career platform, and the one most
    // likely to end up in a log by accident.
    sensitive: true,
    allowedValues: [],
  },
];
