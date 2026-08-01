/**
 * Zentavio's actual configuration schema.
 *
 * **Only keys something reads today.** The areas anticipated in
 * `docs/development/environment.md` — PostgreSQL, Redis, Qdrant, connector credentials, billing —
 * are deliberately absent: declaring a key before anything reads it means the first reader
 * inherits an untested default, and `.env.example` starts lying about what is needed.
 *
 * Adding a key: define it here, add it to `.env.example`, read it only through this package.
 */

import type { Schema } from './schema.ts';

/**
 * The eval runner reads these two today (`ai/shared/evals/model.py`). They are duplicated there
 * as Python `os.environ` defaults, which is the polyglot cost ADR-0003 accepted — the names and
 * defaults must stay in step, and this file is the source of truth for both.
 */
export const evalSchema = {
  ollamaHost: {
    env: 'OLLAMA_HOST',
    type: 'url',
    protocols: ['http', 'https'],
    default: 'http://127.0.0.1:11434',
    description: 'Ollama host for graded prompt evals (ADR-0009)',
  },
  evalModel: {
    env: 'ZENTAVIO_EVAL_MODEL',
    type: 'string',
    minLength: 1,
    default: 'qwen2.5:7b-instruct',
    description: 'Pinned model for graded evals, so delta reports are comparable between machines',
  },
} as const satisfies Schema;

/**
 * PostgreSQL, added with `createDb` in `@zentavio/db` (ADR-0012's follow-up says these arrive in
 * the same change as the first connection code, not before).
 *
 * `databaseUrl` has **no default**: a wrong-but-plausible default is how a developer runs
 * migrations against the wrong database. Absent means the process fails to start and says which
 * variable is missing.
 */
export const databaseSchema = {
  databaseUrl: {
    env: 'ZENTAVIO_DATABASE_URL',
    type: 'string',
    minLength: 1,
    secret: true,
    description: 'PostgreSQL connection string (contains credentials)',
  },
  databaseMaxConnections: {
    env: 'ZENTAVIO_DATABASE_MAX_CONNECTIONS',
    type: 'number',
    integer: true,
    min: 1,
    max: 100,
    default: 10,
    description: 'Pool size per process',
  },
  databaseConnectionTimeoutMs: {
    env: 'ZENTAVIO_DATABASE_CONNECTION_TIMEOUT_MS',
    type: 'number',
    integer: true,
    min: 100,
    default: 5000,
    description: 'Fail fast rather than queueing behind an exhausted pool',
  },
} as const satisfies Schema;

/**
 * The database the Vitest `integration` project owns (ADR-0007).
 *
 * Separate from `databaseUrl` rather than reusing it, because the integration helper drops and
 * recreates the schema before each run. Pointing that at a developer's working database would
 * destroy it, and a suite that *can* do that eventually does. The helper additionally refuses any
 * connection string whose database name does not end in `_test`, so two independent things have to
 * be wrong before data is lost.
 *
 * Not part of `zentavioSchema`: no running process reads it, only the test suite.
 */
export const testDatabaseSchema = {
  testDatabaseUrl: {
    env: 'ZENTAVIO_TEST_DATABASE_URL',
    type: 'string',
    minLength: 1,
    secret: true,
    description:
      'PostgreSQL connection string for the integration suite. Its database is dropped and rebuilt, and its name must end in _test',
  },
} as const satisfies Schema;

/**
 * Where `services/api-gateway` reaches `ai/resume-parser` (ADR-0003).
 *
 * No default. A plausible-but-wrong default here means uploads silently fail against localhost in
 * an environment where the parser lives somewhere else — the same reasoning that keeps
 * `databaseUrl` required.
 */
export const parserSchema = {
  resumeParserUrl: {
    env: 'ZENTAVIO_RESUME_PARSER_URL',
    type: 'url',
    description: 'Base URL of the résumé parser service, e.g. http://127.0.0.1:8001',
  },
} as const satisfies Schema;

/**
 * The whole schema. One object so `envKeys` can generate the complete `.env.example`, and so a
 * reader cannot forget a section exists.
 */
export const zentavioSchema = {
  ...evalSchema,
  ...databaseSchema,
  ...parserSchema,
} as const satisfies Schema;

export type ZentavioConfig = {
  readonly [K in keyof typeof zentavioSchema]: (typeof zentavioSchema)[K] extends {
    type: 'number';
  }
    ? number
    : (typeof zentavioSchema)[K] extends { type: 'boolean' }
      ? boolean
      : string;
};
