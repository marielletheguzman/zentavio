/**
 * The composition root.
 *
 * Adapters are injected here, never instantiated inside a use case
 * (`.claude/skills/backend-service/SKILL.md`). That is what lets `ResumeService` be tested against a
 * fake parser and a compile-only database without touching either.
 *
 * Configuration is read through `packages/config` and nowhere else — `process.env` outside that
 * package fails the build (`eslint.config.mjs`, ADR-0005).
 */

import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { Kysely } from 'kysely';
import { createDb, type Database } from '@zentavio/db';
import { databaseSchema, devAuthSchema, load, oidcSchema, parserSchema } from '@zentavio/config';
import {
  DenyAllSubjectResolver,
  InsecureDevSubjectResolver,
  OidcVerifier,
  type SubjectResolver,
} from '@zentavio/auth';
import { OidcSubjectResolver } from './auth/oidc-subject.resolver.ts';
import { SubjectGuard } from './auth/subject.guard.ts';
import { GapClient } from './gap/gap-client.ts';
import { GapController } from './gap/gap.controller.ts';
import { GapService } from './gap/gap.service.ts';
import { HealthController } from './health/health.controller.ts';
import { ParserClient } from './resume/parser-client.ts';
import { ResumeController } from './resume/resume.controller.ts';
import { ResumeService } from './resume/resume.service.ts';
import { DATABASE, GAP_CLIENT, PARSER_CLIENT, SUBJECT_RESOLVER } from './tokens.ts';

@Module({
  controllers: [ResumeController, GapController, HealthController],
  providers: [
    {
      provide: DATABASE,
      useFactory: (): Kysely<Database> => {
        const config = load(databaseSchema);
        return createDb({
          connectionString: config.databaseUrl,
          maxConnections: config.databaseMaxConnections,
          connectionTimeoutMs: config.databaseConnectionTimeoutMs,
        });
      },
    },
    {
      provide: PARSER_CLIENT,
      useFactory: (): ParserClient =>
        new ParserClient({ baseUrl: load(parserSchema).resumeParserUrl }),
    },
    {
      provide: GAP_CLIENT,
      useFactory: (): GapClient => new GapClient({ baseUrl: load(parserSchema).skillGapUrl }),
    },
    GapService,
    {
      provide: SUBJECT_RESOLVER,
      useFactory: (db: Kysely<Database>): SubjectResolver => {
        const { oidcIssuer, oidcAudience } = load(oidcSchema);
        const { insecureDevAuth, nodeEnv } = load(devAuthSchema);

        // Real authentication wins whenever it is configured. Ordering matters: if the dev flag
        // were checked first, leaving it set in a properly-configured environment would silently
        // downgrade the whole service.
        if (oidcIssuer !== '' && oidcAudience !== '') {
          return new OidcSubjectResolver(
            new OidcVerifier({ issuer: oidcIssuer, audience: oidcAudience }),
            db,
          );
        }

        if (insecureDevAuth) {
          return new InsecureDevSubjectResolver({
            enabled: true,
            isProduction: nodeEnv === 'production',
          });
        }

        // Nothing configured: a locked door, not an open one.
        return new DenyAllSubjectResolver();
      },
      inject: [DATABASE],
    },
    {
      // Global, not per-route: opting a route IN to protection is a list someone forgets, and the
      // route they forget is the one that leaks.
      provide: APP_GUARD,
      useFactory: (resolver: SubjectResolver): SubjectGuard => new SubjectGuard(resolver),
      inject: [SUBJECT_RESOLVER],
    },
    {
      provide: ResumeService,
      useFactory: (db: Kysely<Database>, parser: ParserClient): ResumeService =>
        new ResumeService(db, parser),
      inject: [DATABASE, PARSER_CLIENT],
    },
  ],
})
export class AppModule {}
