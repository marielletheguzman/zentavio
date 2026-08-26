/**
 * What every job-board connector produces, so ingestion can run one without naming it.
 *
 * The requirement path has had this since M2 — `SourcedRequirement` is why `planIngest` can take any
 * immigration source. Job postings did not, because there was one connector and its own type was
 * enough. A runner that iterates the registry needs the shared shape: without it, the only way to
 * turn a connector's output into rows is a per-source adapter, which is a source named somewhere it
 * must not be (ADR-0002).
 *
 * Every field a source does not state is `null`. Never a default, never a guess (ADR-0033).
 */

/** One published opening, as a connector read it from one source. */
export interface JobPosting {
  /** The connector's own `meta.id`. */
  readonly sourceId: string;
  /**
   * The namespace `externalId` belongs to — a Lever board slug, an ATS tenant — and `''` when the
   * source has one global namespace.
   *
   * **A namespace, never an employer.** Resolving it to a company is the invention ADR-0033 refuses,
   * and `dedup_basis` exists because it cannot be done honestly (ADR-0034).
   */
  readonly sourceScope: string;
  /** The source's own identifier, verbatim. Identity is `(sourceId, sourceScope, externalId)`. */
  readonly externalId: string;
  readonly title: string;
  /** Where a person applies. A posting without one is not stored: it cannot be acted on. */
  readonly url: string;
  /** What the source called the employer, when it said anything. Never derived from a scope. */
  readonly companyNameRaw: string | null;
  /**
   * The posting's own prose, as the source rendered it in plain text.
   *
   * Stored, **never read for facts** (ADR-0033). It is here because skill extraction needs an input
   * and nothing else in a posting carries one: without it, every posting ingested is permanently
   * un-extractable, since the raw payload is only archived where a document store is configured.
   */
  readonly description: string | null;
  /**
   * The source's own requirement lists — "Qualifications", "Duties" — flattened to plain text.
   *
   * Separate from `description` because this is where a posting states what it wants, and merging
   * the two would lose which sentences were requirements and which were company prose. A connector
   * flattening markup performs a **mechanical** transformation and no interpretation.
   */
  readonly requirementsText: string | null;
  readonly countryCode: string | null;
  /** Free text, carried for display and never mined for a country. */
  readonly locationText: string | null;
  /** `null` means the source did not say. It does not mean on-site. */
  readonly isRemote: boolean | null;
  /** `'worldwide' | 'country' | 'region'`, and null unless a source states it. */
  readonly remoteScope: string | null;
  readonly department: string | null;
  readonly team: string | null;
  /** The source's own vocabulary, unmapped: Lever's `"Regular Full Time (Salary)"`. */
  readonly commitment: string | null;
  /**
   * Whether the source published pay at all.
   *
   * "The source published none" and "we failed to parse one" are different facts, and only the
   * second is a bug we need to see.
   */
  readonly salaryIsStated: boolean;
  readonly salaryMin: number | null;
  readonly salaryMax: number | null;
  readonly currency: string | null;
  readonly salaryPeriod: string | null;
  /** ISO-8601 UTC, or null when the source states no date. */
  readonly postedAt: string | null;
  readonly sourceTier: number;
  /** The URL the payload was read from, for provenance. Not where a person applies — that is `url`. */
  readonly sourceUrl: string;
  /** ISO-8601 UTC, recorded at fetch time so `normalize` stays pure. */
  readonly retrievedAt: string;
}

/**
 * What the discovery surface shows for one posting.
 *
 * Shaped by the rules `docs/roadmap/backlog.md` sets for this surface, and every one of them is a
 * property of the *shape* rather than of the code that fills it in:
 *
 * - **Skill Fit is an object, never a bare number.** `score: 0` and "not evaluatable" are different
 *   answers (ADR-0037), and a `number | null` invites a UI to render both as `0%`. A caller has to
 *   read `status` to reach the number, so the distinction cannot be skipped by accident.
 * - **The three sponsorship signals stay separate**, each with the sentence it came from. They are
 *   never merged into one "immigration-friendly" label: five merged signals cannot be un-merged.
 * - **`employer` is nullable and says which case it is.** `company_id` is null on every stored
 *   posting today, so this is the common path rather than an edge one.
 */
export interface JobPostingWire {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  /** Where it came from, so a claim on this listing can be traced to a source. */
  readonly source: { readonly id: string; readonly scope: string };
  readonly employer: JobEmployerWire;
  readonly location: {
    readonly raw: string | null;
    readonly countryCode: string | null;
    /** `null` means the source said nothing — never rendered as "not remote" (ADR-0033). */
    readonly isRemote: boolean | null;
    readonly remoteScope: string | null;
  };
  readonly postedAt: string | null;
  readonly sponsorship: SponsorshipSignalsWire;
  readonly skillFit: SkillFitWire;
}

/**
 * The employer, or the fact that nobody has resolved one.
 *
 * `nameRaw` is what the source itself supplied, which for an ATS board is nothing (ADR-0034). Both
 * being absent is the honest state of every posting stored today, and the surface is required to
 * show it as a gap rather than hide the column.
 */
export interface JobEmployerWire {
  readonly companyId: string | null;
  readonly name: string | null;
  readonly nameRaw: string | null;
}

/** One sponsorship signal: the four-valued status and the sentence that stated it. */
export interface SponsorshipSignalWire {
  readonly status: 'stated_available' | 'stated_unavailable' | 'inferred_likely' | 'unknown';
  /** The verbatim sentence, present only for a stated status. */
  readonly span: string | null;
}

export interface SponsorshipSignalsWire {
  readonly visaSponsorship: SponsorshipSignalWire;
  readonly relocationSupport: SponsorshipSignalWire;
  readonly immigrationAssistance: SponsorshipSignalWire;
  /** Which extraction pass produced these, so a rule change is visible as a version rather than a diff. */
  readonly extractorVersion: string | null;
}

/**
 * Skill Fit, and **never a Job Match Score** (ADR-0037).
 *
 * `unscored` is not a failure: it is the answer when a posting states no requirements, because
 * coverage over an empty set has no denominator and `1.0` would make the least informative posting
 * the best match.
 */
export type SkillFitWire =
  | { readonly status: 'unscored'; readonly reason: 'not-computed' | 'no-requirements' }
  | {
      readonly status: 'scored';
      /** 0 is a real answer — checked, and nothing overlapped. */
      readonly score: number;
      readonly scorerVersion: string;
      readonly evidence: readonly SkillFitEvidenceWire[];
    };

/** One skill's contribution, with why it counted for what it did. */
export interface SkillFitEvidenceWire {
  readonly skillSlug: string;
  readonly basis: string;
  readonly contribution: number;
}
