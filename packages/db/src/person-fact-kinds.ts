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
 *
 * **One entry is currently an exception, and it is named rather than hidden.**
 * `qualification_awarded_in` has no ingested rule reading it yet: ADR-0029 sequences the mechanism
 * — the fact, the origin scope on retrieval, the evaluator's matching — ahead of the recognition
 * research that produces the first rule, because the research is the expensive half and the shape
 * has to exist for it to land into. The exception is bounded two ways: nothing renders the question
 * until a rule names it in `needs_input`, so no one is asked it in the meantime; and if the M5
 * recognition slice does not land, this entry comes out again rather than sitting here as a
 * question with no rule to justify it.
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
  {
    key: 'employment_contract_months',
    valueType: 'integer',
    unit: 'months',
    prompt: 'How many months does the job offer run for?',
    rationale:
      '§ 18g Abs. 3 AufenthG requires the offer to provide for at least six months of employment. ' +
      'A shorter contract does not qualify, however well paid it is.',
    sensitive: false,
    allowedValues: [],
  },
  {
    key: 'years_since_degree_awarded',
    valueType: 'integer',
    unit: 'years',
    prompt: 'How many years ago was your degree awarded?',
    rationale:
      '§ 18g Abs. 1 S. 2 Nr. 2 AufenthG gives the reduced salary threshold to anyone whose degree ' +
      'was awarded no more than three years before applying, whatever their occupation. It is a ' +
      'second, independent way into the same threshold as the listed ISCO-08 groups.',
    sensitive: false,
    allowedValues: [],
  },
  {
    key: 'years_relevant_experience_last_seven',
    valueType: 'integer',
    unit: 'years',
    // The seven-year window is in the question deliberately. § 18g Abs. 2 Nr. 3 a) counts only
    // experience acquired in the last seven years, and a bare career total would quietly admit
    // three years earned a decade ago.
    prompt:
      'In the last seven years, how many years have you worked in this occupation group?',
    rationale:
      '§ 18g Abs. 2 AufenthG admits ICT and IT professionals (ISCO-08 groups 133 and 25) without ' +
      'a degree, on at least three years of experience acquired within the last seven. This is ' +
      'the route for people the degree question would otherwise wrongly exclude.',
    sensitive: false,
    allowedValues: [],
  },
  {
    key: 'has_recognised_academic_degree',
    valueType: 'boolean',
    unit: null,
    // § 18g Abs. 1 S. 5 widens what counts, so the question has to widen with it. Asked as
    // "a degree" alone, someone holding an equivalent tertiary qualification answers no and is
    // excluded from a route the statute admits them to.
    prompt:
      'Do you hold a recognised higher-education degree, or an equivalent tertiary qualification ' +
      'of at least three years at ISCED 2011 or EQF level 6?',
    rationale:
      '§ 18g Abs. 1 S. 1 AufenthG addresses a Fachkraft mit akademischer Ausbildung, and Abs. 1 ' +
      'S. 5 extends that to an equivalent tertiary programme of at least three years at ISCED ' +
      '2011 or EQF level 6. Whether a particular qualification counts is decided by recognition ' +
      'rules we have not sourced, so a no here means we cannot confirm this route rather than ' +
      'that no route exists — § 18g Abs. 2 admits ICT and IT professionals without one.',
    sensitive: false,
    allowedValues: [],
  },
  {
    key: 'expected_gross_hourly_pay_nzd',
    valueType: 'monetary',
    unit: 'NZD/hour',
    prompt: 'What gross hourly pay does the job offer, in New Zealand dollars?',
    rationale:
      'New Zealand assesses remuneration as guaranteed payment per hour (Immigration Instructions ' +
      'WA3.25), and the Accredited Employer Work Visa floor is the adult minimum wage — also ' +
      'published hourly. Asked in the same unit both instruments use, so nothing is converted.',
    // Pay, like the German salary question, and for the same reason.
    sensitive: true,
    allowedValues: [],
  },
  {
    key: 'has_offer_from_accredited_employer',
    valueType: 'boolean',
    // The subject of the underlying rule is the **employer and the job**, not the person — WA2 is
    // accreditation and WA3 is the Job Check. The applicant can still answer it, which is why it
    // is an ordinary fact rather than a new shape: they know who is hiring them, and INZ publishes
    // the accredited-employer list.
    unit: null,
    prompt:
      'Is your job offer from an employer accredited by Immigration New Zealand, for a role that ' +
      'has passed a Job Check?',
    rationale:
      'The Accredited Employer Work Visa is granted on an offer that meets the requirements at ' +
      'WA4.10.1 — which depend on the employer holding accreditation and the job holding an ' +
      'approved Job Check. Without both, no AEWV can be granted however well the person qualifies.',
    sensitive: false,
    allowedValues: [],
  },
  {
    key: 'vacancy_reported_to_public_employment_service',
    valueType: 'boolean',
    unit: null,
    // The duty is the employer's, and it applies only in occupations above a stated national
    // unemployment level (AIG art. 21a). The applicant can answer it — their employer tells them —
    // but the question is about the vacancy rather than about them.
    prompt: 'Was this vacancy reported to the public employment service before it was offered?',
    rationale:
      'Switzerland requires vacancies in occupations with high unemployment to be reported to the ' +
      'public employment service before a third-country national may be admitted to them ' +
      '(AIG art. 21a; Weisungen AIG Ziff. 4.3.3).',
    sensitive: false,
    allowedValues: [],
  },
  {
    key: 'has_recognised_professional_qualification',
    valueType: 'boolean',
    unit: null,
    // Deliberately broader than the German degree question: Switzerland accepts qualification at
    // several levels — university, higher vocational training, or years of relevant experience —
    // and which suffices is judged per occupation. One question, decided in context.
    prompt:
      'Do you hold a professional qualification — a degree, higher vocational training, or ' +
      'equivalent experience — for the work you would be doing?',
    rationale:
      'AIG art. 23 admits managers, specialists and other qualified workers, and the Weisungen ' +
      '(Ziff. 4.3.5) accept qualification at several levels depending on the occupation.',
    sensitive: false,
    allowedValues: [],
  },
  {
    key: 'qualification_awarded_in',
    valueType: 'string',
    unit: null,
    // ISO 3166-1 alpha-2, and deliberately **not** nationality (ADR-0029). A Filipino citizen
    // holding a German nursing degree has no recognition problem; a German citizen holding a
    // Philippine one does. Recognition follows the qualification, so the question asks where the
    // qualification was awarded and says so in those words — "your country" would be read as the
    // passport by most people answering it.
    prompt:
      'In which country was your professional qualification awarded? Give the two-letter country ' +
      'code, such as PH for the Philippines.',
    rationale:
      'A regulated profession is licensed at origin and re-assessed at destination, and which ' +
      'recognition rules apply depends on where the qualification comes from rather than on ' +
      'citizenship (ADR-0029). Without it a recognition rule cannot be matched to you, and the ' +
      'verdict stays undetermined with this question named as what would resolve it.',
    // Where a qualification was awarded is close enough to origin and ethnicity to deserve the
    // flag; `person-fact.md` routes `sensitive` kinds to column-level encryption in the production
    // posture.
    sensitive: true,
    allowedValues: [],
  },
  {
    key: 'isco_08_group',
    valueType: 'string',
    unit: null,
    prompt: 'Which ISCO-08 occupational group does the role fall under?',
    rationale:
      'Roles in the groups § 18g Abs. 1 S. 2 lists qualify at the reduced salary threshold. This ' +
      'can only lower the bar, never raise it.',
    sensitive: false,
    allowedValues: [],
  },
];
