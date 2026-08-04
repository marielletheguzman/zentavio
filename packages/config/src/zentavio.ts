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
    // Raised from qwen2.5:7b-instruct on 2026-08-03 by the eval run conventions.md requires for a
    // route change. 7b cannot pass instruction-quarantine's injection gates at all: asked to
    // classify lines of a document it silently omits the injected line, under every prompt shape
    // tried. 14b passes 9/9 on that suite and 9/10 on skill-recall, both with zero gate failures.
    // "Smallest model that passes evals" is still the rule — 7b does not pass.
    default: 'qwen2.5:14b-instruct',
    description: 'Pinned model for graded evals, so delta reports are comparable between machines',
  },
  parserModel: {
    env: 'ZENTAVIO_PARSER_MODEL',
    type: 'string',
    minLength: 1,
    // Separate from evalModel even though the value matches today. They answer different
    // questions: the eval pin exists so delta reports compare like with like across machines and
    // moves only with a recorded baseline, while this one is what actually serves traffic. Fusing
    // them would mean a routing change silently invalidated every recorded baseline.
    default: 'qwen2.5:14b-instruct',
    description: 'Model backing skill-recall and instruction-quarantine in ai/resume-parser',
  },
  parserEnrichment: {
    env: 'ZENTAVIO_PARSER_ENRICHMENT',
    type: 'string',
    minLength: 1,
    // 'on' | 'off'. Off is a supported configuration, not a broken one: the parser produces a
    // complete deterministic profile without a model, and the response says enrichment did not
    // run (ADR-0018). Useful where no model host exists — CI, a reviewer's laptop.
    default: 'on',
    description: "Whether ai/resume-parser calls a model at all: 'on' or 'off'",
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
  webOrigin: {
    env: 'ZENTAVIO_WEB_ORIGIN',
    type: 'string',
    // **No default, and the absence is a closed door.** With this unset the gateway sends no CORS
    // headers, so no browser can call it — the same posture as authentication, where nothing
    // configured means deny rather than allow.
    //
    // Never `*`. This API is authenticated, and a wildcard origin on an authenticated API is the
    // hole that lets any page a user visits act as them.
    default: '',
    description:
      "Origin allowed to call the gateway from a browser, e.g. http://127.0.0.1:3000. Empty disables CORS entirely",
  },
  skillGapUrl: {
    env: 'ZENTAVIO_SKILL_GAP_URL',
    type: 'url',
    // No default, for the same reason as the parser URL and the database URL: a
    // plausible-but-wrong default fails silently against the wrong host, and a gap computed by
    // something other than the service you meant is indistinguishable from a correct one.
    description: 'Base URL of the skill-gap service, e.g. http://127.0.0.1:8002',
  },
  careerRoadmapUrl: {
    env: 'ZENTAVIO_CAREER_ROADMAP_URL',
    type: 'url',
    // No default, for the same reason as every other service URL: a plausible-but-wrong default
    // fails silently against the wrong host, and an eligibility verdict produced by something
    // other than the service you meant is indistinguishable from a correct one. That matters more
    // here than anywhere else, because the output is what someone plans a relocation around.
    description: 'Base URL of the career-roadmap (eligibility) service, e.g. http://127.0.0.1:8003',
  },
} as const satisfies Schema;

/**
 * The identity provider (ADR-0017).
 *
 * **Deliberately not naming a vendor.** OIDC is a standard, so Clerk, WorkOS, Auth0, or a
 * self-hosted Keycloak differ only in these values. Both are optional: when unset, the gateway
 * falls back to deny-by-default rather than starting without authentication.
 */
export const oidcSchema = {
  oidcIssuer: {
    env: 'ZENTAVIO_OIDC_ISSUER',
    type: 'string',
    default: '',
    description: 'OIDC issuer URL, exactly as the provider states it. Empty disables OIDC',
  },
  oidcAudience: {
    env: 'ZENTAVIO_OIDC_AUDIENCE',
    type: 'string',
    default: '',
    description:
      'This application client id. A token minted for another audience of the same provider is refused',
  },
} as const satisfies Schema;

/**
 * The escape hatch that lets M1a be demonstrated while ADR-0017's provider is being provisioned.
 *
 * **Named to be alarming on purpose.** `ZENTAVIO_INSECURE_DEV_AUTH` appears in a deployment
 * checklist, a shell history, and a log — and at every one of those it should read as a mistake.
 * Defaults to `false`, and `InsecureDevSubjectResolver` refuses in production regardless.
 */
export const devAuthSchema = {
  insecureDevAuth: {
    env: 'ZENTAVIO_INSECURE_DEV_AUTH',
    type: 'boolean',
    default: false,
    description:
      'Trust an x-zentavio-dev-user header instead of authenticating. Development only; ignored in production',
  },
  nodeEnv: {
    env: 'NODE_ENV',
    type: 'string',
    default: 'development',
    description: 'Runtime environment. Production disables the insecure dev resolver outright',
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
  ...devAuthSchema,
  ...oidcSchema,
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
