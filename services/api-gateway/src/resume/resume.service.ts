/**
 * The upload use case: document in, profile version out.
 *
 * No HTTP concepts here — no `Request`, no status codes, no headers
 * (`.claude/skills/backend-service/SKILL.md`). The controller translates; this orchestrates.
 *
 * The order matters and is not arbitrary: **the closed set is read from the database and passed to
 * the parser**, rather than the parser holding a registry. That is what keeps `ai/` stateless
 * (ADR-0003) and what guarantees the slugs coming back already exist as rows — the parser cannot
 * return a skill the database has never heard of, because it was only ever given ours.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Database } from '@zentavio/db';
import {
  applyCorrection,
  createProfileVersion,
  currentProfile,
  profileSkills,
  type ProfileSkillInput,
  type ProfileVersion,
} from '@zentavio/db';
import type { ParseRequestWire, ParseResponseWire } from '@zentavio/types';
import type { ParserClient, ParserOutcome } from './parser-client.ts';
import { DATABASE, PARSER_CLIENT } from '../tokens.ts';

export type UploadOutcome =
  | {
      readonly kind: 'stored';
      readonly profile: ProfileVersion;
      readonly parse: ParseResponseWire;
    }
  /** The document was read and produced nothing storable — a scan, or an empty result. */
  | { readonly kind: 'not-stored'; readonly parse: ParseResponseWire }
  | { readonly kind: 'rejected'; readonly code: string; readonly message: string }
  | { readonly kind: 'unavailable'; readonly reason: string };

/** One skill as the profile now records it — what a correction returns so the UI can redraw. */
export interface ProfileSkillView {
  readonly slug: string;
  readonly status: 'evidenced' | 'claimed';
  readonly evidenceKind: string | null;
  readonly sourceSpan: string | null;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly selfReported: boolean;
}

export type CorrectionOutcome =
  | { readonly kind: 'corrected'; readonly version: number; readonly skills: readonly ProfileSkillView[] }
  | { readonly kind: 'no-profile' }
  | { readonly kind: 'unknown-skill'; readonly slug: string };

@Injectable()
export class ResumeService {
  readonly #logger = new Logger(ResumeService.name);
  readonly #db: Kysely<Database>;
  readonly #parser: ParserClient;

  // Not a parameter property: `erasableSyntaxOnly` is off for this package but the convention
  // across the repo is explicit assignment, and it keeps the DI shape readable.
  constructor(@Inject(DATABASE) db: Kysely<Database>, @Inject(PARSER_CLIENT) parser: ParserClient) {
    this.#db = db;
    this.#parser = parser;
  }

  async upload(input: {
    readonly userId: string;
    readonly careerId?: string | undefined;
    readonly content: Buffer;
    readonly contentType: string;
  }): Promise<UploadOutcome> {
    const registry = await this.#closedSet();

    const request: ParseRequestWire = {
      document_base64: input.content.toString('base64'),
      content_type: input.contentType,
      skills: registry.map(({ slug, name, kind, aliases }) => ({ slug, name, kind, aliases })),
    };

    const outcome: ParserOutcome = await this.#parser.parse(request);

    if (outcome.kind === 'rejected') {
      return { kind: 'rejected', code: outcome.code, message: outcome.message };
    }
    if (outcome.kind === 'unavailable') {
      // No correlation id from the parser here — it never answered. The gateway's own filter
      // supplies one so the user still has something to quote.
      this.#logger.warn(`parser unavailable: ${outcome.reason}`);
      return { kind: 'unavailable', reason: outcome.reason };
    }

    const parse = outcome.response;

    // An `unknown` parse is a real result, and it is deliberately NOT stored. Writing an empty
    // profile version would overwrite a good earlier one with nothing — the user uploads a scan by
    // mistake and loses the profile they already had.
    if (parse.status === 'unknown' || parse.skills.length === 0) {
      return { kind: 'not-stored', parse };
    }

    // The parser returns slugs; `profile_skills.skill_id` is a uuid foreign key. Mapping through
    // the registry we just supplied is what makes the foreign key satisfiable — and because the
    // parser could only return slugs we sent, every lookup here must hit.
    const idBySlug = new Map(registry.map((row) => [row.slug, row.id]));
    const skills: ProfileSkillInput[] = [];
    for (const skill of parse.skills) {
      const skillId = idBySlug.get(skill.slug);
      if (skillId === undefined) {
        // Unreachable unless the parser invented a slug — which it is built not to do. Dropping it
        // is the safe failure: a foreign-key violation would lose the whole profile.
        this.#logger.error(`parser returned an unknown slug: ${skill.slug}`);
        continue;
      }
      skills.push(toProfileSkill(skillId, skill));
    }

    if (skills.length === 0) return { kind: 'not-stored', parse };

    const profile = await createProfileVersion(this.#db, {
      userId: input.userId,
      skills,
      parsedFrom: 'resume-upload',
      parserVersion: parse.parser_version,
      completeness: parse.completeness,
      currentCareerId: input.careerId ?? null,
    });

    return { kind: 'stored', profile, parse };
  }

  /**
   * Apply a user's correction to one skill.
   *
   * The repository writes a **new profile version** rather than editing the current one, so a score
   * already computed against v1 stays reproducible. That is the whole reason profiles are versioned,
   * and it is why this returns the new version number — the caller is looking at v1 and needs to
   * know it is now looking at v2.
   */
  async correct(input: {
    readonly userId: string;
    readonly slug: string;
    readonly status: 'evidenced' | 'claimed';
    readonly evidenceKind?: ProfileSkillInput['evidence_kind'];
  }): Promise<CorrectionOutcome> {
    const profile = await currentProfile(this.#db, input.userId);
    if (!profile) return { kind: 'no-profile' };

    const skill = await this.#db
      .selectFrom('skills')
      .select('id')
      .where('slug', '=', input.slug)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();

    // Resolved here so an unknown slug is a 400 naming it, rather than a foreign key violation
    // surfacing as a 500 from somewhere deeper.
    if (!skill) return { kind: 'unknown-skill', slug: input.slug };

    const corrected = await applyCorrection(this.#db, input.userId, {
      kind: 'upsert',
      skillId: skill.id,
      status: input.status,
      ...(input.evidenceKind ? { evidenceKind: input.evidenceKind } : {}),
    });

    const rows = await profileSkills(this.#db, corrected.id);
    return {
      kind: 'corrected',
      version: corrected.version,
      skills: rows.map((row) => ({
        slug: row.slug,
        status: row.status,
        evidenceKind: row.evidence_kind,
        sourceSpan: row.source_span,
        confidence: row.confidence,
        selfReported: row.self_reported,
      })),
    };
  }

  /**
   * Every live skill, with its aliases, as the parser's closed set.
   *
   * One query with an aggregate rather than N+1: the registry is read on every upload, and a per-
   * skill alias query would make a 30-skill set 31 round trips.
   */
  async #closedSet(): Promise<readonly RegistryRow[]> {
    const rows = await this.#db
      .selectFrom('skills')
      .leftJoin('skill_aliases', 'skill_aliases.skill_id', 'skills.id')
      .select([
        'skills.id',
        'skills.slug',
        'skills.name',
        'skills.kind',
        sql<string[]>`coalesce(array_agg(skill_aliases.normalized) filter (where skill_aliases.normalized is not null), '{}')`.as(
          'aliases',
        ),
      ])
      .where('skills.deleted_at', 'is', null)
      .groupBy(['skills.id', 'skills.slug', 'skills.name', 'skills.kind'])
      .execute();

    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      kind: row.kind,
      aliases: row.aliases,
    }));
  }
}

/** A registry row carries the id the foreign key needs and the slug the parser speaks. */
interface RegistryRow {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly kind: string;
  readonly aliases: readonly string[];
}

/**
 * Wire shape to repository shape.
 *
 * `self_reported` is false because this came from a parser, not a person. That distinction is what
 * makes a later correction outweigh it.
 */
function toProfileSkill(
  skillId: string,
  skill: ParseResponseWire['skills'][number],
): ProfileSkillInput {
  return {
    skill_id: skillId,
    status: skill.status,
    evidence_kind: skill.evidence_kind,
    source_span: skill.source_span,
    confidence: skill.confidence,
    self_reported: false,
  };
}
