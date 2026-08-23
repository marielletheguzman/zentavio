/**
 * Reading what an employer states about helping somebody take a job from abroad (ADR-0039).
 *
 * **The strictest extractor in the repository, on purpose.** A false skill costs a misleading gap. A
 * false `stated_available` tells somebody a job solves their immigration problem when it does not,
 * and they act on it — an application, a visa timeline, possibly a move.
 *
 * ## The two rules, and the real spans that produced them
 *
 * Measured over the 239 Zoox postings: 3 mention the topic at all, and two are the wrong sense.
 *
 * **A mention of the topic is not a statement of availability.**
 *
 *     "...partnering with stakeholders across engineering and earning executive sponsorship."
 *     "...often involving complex compensation, negotiation, and relocation strategies."
 *
 * Stakeholder buy-in, and a recruiter's job description. Both are `unknown`, and both are permanent
 * regression cases.
 *
 * **A requirement placed on the candidate is not an employer offer.**
 *
 *     "Continued employment is contingent upon obtaining valid US work authorization and visa
 *      eligibility. Company visa sponsorship and relocation assistance details will be provided
 *      during the interview process."
 *
 * Genuine, and still not a statement that the benefit exists: details *will be provided*, and the
 * obligation is the candidate's. `unknown`.
 *
 * ## How the rules are enforced without a phrase blocklist
 *
 * A benefit is only recognised **qualified** — `visa sponsorship`, not bare `sponsorship`; `relocation
 * assistance`, not bare `relocation`. That alone rejects both wrong-sense spans, because "executive
 * sponsorship" and "relocation strategies" are different phrases rather than the same phrase in a
 * different context.
 *
 * Then the benefit must sit **adjacent** to an availability or refusal predicate, with only a small
 * closed set of tokens allowed between them. `"visa sponsorship and relocation assistance details
 * will be provided"` fails: after `visa sponsorship` comes `and`, which is not a bridging token, and
 * after `relocation assistance` comes `details`, which is a meta-noun about the benefit rather than
 * the benefit itself.
 *
 * A blocklist of bad phrases would have been curation wearing code's clothing and would never have
 * been finished — the same reasoning that put alias ambiguity in the vocabulary rather than the
 * scanner.
 *
 * ## Pure
 *
 * Text in, statuses and spans out. No database, no clock, no model. `inferred_likely` is never
 * produced here and is refused by CHECK: it belongs to registries and aggregated outcomes, which have
 * no table and no join key (ADR-0039).
 */

export const SPONSORSHIP_EXTRACTOR_VERSION = 'sponsorship-statement@1.0.0';

export type SponsorshipStatus =
  | 'stated_available'
  | 'stated_unavailable'
  | 'inferred_likely'
  | 'unknown';

export type BenefitKind = 'visa_sponsorship' | 'relocation_support' | 'immigration_assistance';

export interface BenefitFinding {
  readonly status: SponsorshipStatus;
  /** The sentence as published. Null only when `status` is `unknown`. */
  readonly span: string | null;
}

export type SponsorshipFindings = Readonly<Record<BenefitKind, BenefitFinding>>;

const NOT_FOUND: BenefitFinding = { status: 'unknown', span: null };

/**
 * Qualified benefit phrases, normalized.
 *
 * **Never a bare noun.** `sponsorship` alone matches stakeholder buy-in; `relocation` alone matches a
 * recruiter's job. The qualifier is what makes the phrase about immigration.
 */
const BENEFITS: Readonly<Record<BenefitKind, readonly string[]>> = {
  visa_sponsorship: [
    'visa sponsorship',
    'work permit sponsorship',
    'work visa sponsorship',
    'sponsorship for a visa',
    'sponsor a visa',
    'sponsor visas',
    'sponsor work visas',
    'visa sponsorships',
  ],
  relocation_support: [
    'relocation assistance',
    'relocation support',
    'relocation package',
    'relocation benefits',
    'relocation allowance',
  ],
  immigration_assistance: [
    'immigration assistance',
    'immigration support',
    'immigration services',
    'visa support',
  ],
};

/** Predicates that state the employer provides it. */
const AVAILABLE = [
  'is available',
  'are available',
  'available',
  'is offered',
  'are offered',
  'is provided',
  'are provided',
  'provided',
  'offered',
  'included',
  'is included',
];

/** Predicates that state the employer does not. Checked first — a refusal outranks an offer. */
const UNAVAILABLE = [
  'is not available',
  'are not available',
  'not available',
  'is not offered',
  'are not offered',
  'not offered',
  'is not provided',
  'not provided',
  'unavailable',
  'cannot be offered',
  'will not be provided',
];

/** Verbs by which an employer offers something, when the sentence leads with the employer. */
const EMPLOYER_OFFERS = ['offer', 'offers', 'provide', 'provides', 'sponsor', 'sponsors', 'support', 'supports'];

/** Employer subjects. A sentence about "candidates" is about the candidate's obligation, not an offer. */
const EMPLOYER_SUBJECT = ['we', 'the company', 'company', 'our company', 'zoox'];

/** Negations that flip an employer-offers sentence into a refusal. */
const NEGATIONS = ['do not', 'does not', 'dont', 'doesnt', 'cannot', 'cant', 'are unable to', 'is unable to', 'unable to', 'no'];

/**
 * Tokens permitted between a benefit phrase and its predicate.
 *
 * Deliberately tiny. `and` is absent, which is what rejects `"visa sponsorship and relocation
 * assistance details will be provided"`; `details` is absent, which rejects the second half of the
 * same sentence.
 */
const BRIDGE = new Set(['is', 'are', 'will', 'be', 'also', 'may', 'can', 'was', 'were', 'not']);

/** The same normalization the rest of the pipeline uses: casefolded, punctuation to spaces. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}+#]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function sentences(text: string): readonly string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((line) => line.replace(/^[-*•]\s*/, '').trim())
    .filter((line) => line !== '');
}

/** Whether `phrase` appears in `haystack` as whole tokens, and where it ends. */
function findPhrase(haystack: string, phrase: string): number | null {
  const index = ` ${haystack} `.indexOf(` ${phrase} `);
  return index === -1 ? null : index + phrase.length;
}

/**
 * Whether a predicate follows the benefit closely enough to be about it.
 *
 * Only `BRIDGE` tokens may intervene. Anything else — a conjunction, another noun — means the
 * predicate's subject is something other than the benefit, which is exactly how *"…and relocation
 * assistance details will be provided"* escapes being read as an offer.
 */
function predicateFollows(rest: string, predicates: readonly string[]): boolean {
  const tokens = rest.split(' ').filter(Boolean);

  for (let skipped = 0; skipped <= tokens.length; skipped += 1) {
    const tail = tokens.slice(skipped).join(' ');
    if (predicates.some((predicate) => tail === predicate || tail.startsWith(`${predicate} `))) return true;
    // Stop as soon as a token that is not a permitted bridge is passed over.
    const next = tokens[skipped];
    if (next === undefined || !BRIDGE.has(next)) return false;
  }
  return false;
}

/** Whether the sentence reads "we offer <benefit>", with or without a negation. */
function employerOffers(sentence: string, benefit: string): 'stated_available' | 'stated_unavailable' | null {
  const subject = EMPLOYER_SUBJECT.find((s) => sentence === s || sentence.startsWith(`${s} `));
  if (subject === undefined) return null;
  if (findPhrase(sentence, benefit) === null) return null;

  const after = sentence.slice(subject.length).trim();
  const verbIndex = EMPLOYER_OFFERS.findIndex((verb) => findPhrase(after, verb) !== null);
  if (verbIndex === -1) return null;

  // A negation anywhere before the benefit flips the reading: "we do not offer visa sponsorship".
  const benefitAt = ` ${sentence} `.indexOf(` ${benefit} `);
  const before = sentence.slice(0, Math.max(benefitAt, 0));
  const negated = NEGATIONS.some((n) => ` ${before} `.includes(` ${n} `));
  return negated ? 'stated_unavailable' : 'stated_available';
}

function statusForBenefit(sentence: string, phrases: readonly string[]): SponsorshipStatus | null {
  for (const phrase of phrases) {
    const end = findPhrase(sentence, phrase);
    if (end === null) continue;

    const rest = sentence.slice(end).trim();

    // Refusal first: a stated absence outranks a stated availability in the same sentence.
    if (predicateFollows(rest, UNAVAILABLE)) return 'stated_unavailable';
    if (predicateFollows(rest, AVAILABLE)) return 'stated_available';

    const offered = employerOffers(sentence, phrase);
    if (offered !== null) return offered;
  }
  return null;
}

/**
 * Read the three statuses out of a posting's text.
 *
 * Requirement lists and description are both read: an employer may state sponsorship in either, and
 * unlike a skill the *section* changes nothing about what the claim may assert.
 *
 * **`unknown` is the answer for almost everything, and that is the designed outcome.** A posting that
 * says nothing is `unknown` and processed — never left looking unprocessed (ADR-0036's distinction,
 * kept per pipeline).
 */
export function extractSponsorship(text: {
  readonly description: string | null;
  readonly requirementsText: string | null;
}): SponsorshipFindings {
  const found: Record<BenefitKind, BenefitFinding> = {
    visa_sponsorship: NOT_FOUND,
    relocation_support: NOT_FOUND,
    immigration_assistance: NOT_FOUND,
  };

  for (const body of [text.requirementsText, text.description]) {
    if (body === null) continue;

    for (const raw of sentences(body)) {
      const sentence = normalize(raw);

      for (const kind of Object.keys(BENEFITS) as BenefitKind[]) {
        // First statement wins: re-reading a benefit already decided would let a later, vaguer
        // sentence overwrite the one that actually said something.
        if (found[kind].status !== 'unknown') continue;

        const status = statusForBenefit(sentence, BENEFITS[kind]);
        if (status !== null) found[kind] = { status, span: raw };
      }
    }
  }

  return found;
}
