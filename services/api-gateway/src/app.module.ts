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
import type { Kysely } from 'kysely';
import { createDb, type Database } from '@zentavio/db';
import { databaseSchema, load, parserSchema } from '@zentavio/config';
import { HealthController } from './health/health.controller.ts';
import { ParserClient } from './resume/parser-client.ts';
import { ResumeController } from './resume/resume.controller.ts';
import { ResumeService } from './resume/resume.service.ts';
import { DATABASE, PARSER_CLIENT } from './tokens.ts';

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
      provide: ResumeService,
      useFactory: (db: Kysely<Database>, parser: ParserClient): ResumeService =>
        new ResumeService(db, parser),
      inject: [DATABASE, PARSER_CLIENT],
    },
  ],
})
export class AppModule {}
