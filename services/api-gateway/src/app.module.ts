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
import { DevSubjectResolver } from './auth/dev-subject.resolver.ts';
import { OidcSubjectResolver } from './auth/oidc-subject.resolver.ts';
import { SubjectGuard } from './auth/subject.guard.ts';
import { EligibilityClient } from './eligibility/eligibility-client.ts';
import { EligibilityController } from './eligibility/eligibility.controller.ts';
import { EligibilityService } from './eligibility/eligibility.service.ts';
import { GapClient } from './gap/gap-client.ts';
import { GapController } from './gap/gap.controller.ts';
import { GapService } from './gap/gap.service.ts';
import { ComparisonController } from './comparison/comparison.controller.ts';
import { ComparisonService } from './comparison/comparison.service.ts';
import { InterviewsController } from './interviews/interviews.controller.ts';
import { InterviewsService } from './interviews/interviews.service.ts';
import { LearningController } from './learning/learning.controller.ts';
import { LearningService } from './learning/learning.service.ts';
import { AssessmentsController } from './assessments/assessments.controller.ts';
import { AssessmentsService } from './assessments/assessments.service.ts';
import { ApplicationsController } from './applications/applications.controller.ts';
import { ApplicationsService } from './applications/applications.service.ts';
import { JobsController } from './jobs/jobs.controller.ts';
import { JobsService } from './jobs/jobs.service.ts';
import { HealthController } from './health/health.controller.ts';
import { ParserClient } from './resume/parser-client.ts';
import { ResumeController } from './resume/resume.controller.ts';
import { ResumeService } from './resume/resume.service.ts';
import { DATABASE, ELIGIBILITY_CLIENT, GAP_CLIENT, PARSER_CLIENT, SUBJECT_RESOLVER } from './tokens.ts';

@Module({
  controllers: [
    ResumeController,
    GapController,
    EligibilityController,
    ComparisonController,
    ApplicationsController,
    JobsController,
    AssessmentsController,
    LearningController,
    InterviewsController,
    HealthController,
  ],
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
      provide: ELIGIBILITY_CLIENT,
      useFactory: (): EligibilityClient =>
        new EligibilityClient({ baseUrl: load(parserSchema).careerRoadmapUrl }),
    },
    EligibilityService,
    // Depends on both by class: one date, one readiness, one evaluator run across every
    // destination (ADR-0026).
    ComparisonService,
    // Depends on `GapService` by class, like `EligibilityService`: the prediction stored with an
    // application is the readiness score computed by the same code that shows it (ADR-0019).
    ApplicationsService,
    JobsService,
    AssessmentsService,
    LearningService,
    InterviewsService,
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
          // Wrapped so the dev credential provisions its user the way a real one does. Without it,
          // a header naming an id with no row fails as a foreign key violation several layers down
          // — a 500 whose cause is invisible from the response.
          return new DevSubjectResolver(
            new InsecureDevSubjectResolver({
              enabled: true,
              isProduction: nodeEnv === 'production',
            }),
            db,
          );
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
