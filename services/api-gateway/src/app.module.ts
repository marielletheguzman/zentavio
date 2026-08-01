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
import { databaseSchema, load, parserSchema, devAuthSchema } from '@zentavio/config';
import {
  DenyAllSubjectResolver,
  InsecureDevSubjectResolver,
  type SubjectResolver,
} from '@zentavio/auth';
import { SubjectGuard } from './auth/subject.guard.ts';
import { HealthController } from './health/health.controller.ts';
import { ParserClient } from './resume/parser-client.ts';
import { ResumeController } from './resume/resume.controller.ts';
import { ResumeService } from './resume/resume.service.ts';
import { DATABASE, PARSER_CLIENT, SUBJECT_RESOLVER } from './tokens.ts';

@Module({
  controllers: [ResumeController, HealthController],
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
      provide: SUBJECT_RESOLVER,
      useFactory: (): SubjectResolver => {
        // Deny-by-default: the insecure resolver is only constructed when a flag that says exactly
        // what it is has been set, and it refuses in production regardless (ADR-0017).
        const { insecureDevAuth } = load(devAuthSchema);
        return insecureDevAuth
          ? new InsecureDevSubjectResolver({
              enabled: true,
              isProduction: load(devAuthSchema).nodeEnv === 'production',
            })
          : new DenyAllSubjectResolver();
      },
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
