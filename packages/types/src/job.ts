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
