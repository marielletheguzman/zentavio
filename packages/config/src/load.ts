/**
 * Loading and validating configuration.
 *
 * Two properties matter more than the parsing:
 *
 * **Validated at startup, not at first use.** A service with a missing or malformed required value
 * must fail to start with a message naming the key — never start and fail later on the request
 * that happens to need it (`docs/development/environment.md`).
 *
 * **Every problem reported at once.** Fail-fast validation costs one restart per mistake; a
 * misconfigured deployment with four missing variables should say so once.
 */

import { parseValue, type ConfigValue, type Resolved, type Schema, type ValidationIssue } from './schema.js';

export class ConfigError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    const lines = issues.map((i) => `  ${i.env} (${i.key}): ${i.problem}`);
    super(`Invalid configuration:\n${lines.join('\n')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

/**
 * `process.env` is read here and nowhere else in the repository — a lint rule fails the build
 * otherwise (ADR-0005). Passing `env` explicitly is what makes this testable without mutating
 * global state.
 */
export function load<S extends Schema>(
  schema: S,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Resolved<S> {
  const issues: ValidationIssue[] = [];
  const resolved: Record<string, ConfigValue> = {};

  for (const [key, spec] of Object.entries(schema)) {
    const raw = env[spec.env];

    if (raw === undefined || raw === '') {
      if (spec.default === undefined) {
        issues.push({
          key,
          env: spec.env,
          problem: `required but not set — ${spec.description}`,
        });
        continue;
      }
      resolved[key] = spec.default;
      continue;
    }

    const result = parseValue(spec, raw);
    if ('problem' in result) {
      // The raw value is deliberately absent from a secret's message.
      issues.push({ key, env: spec.env, problem: result.problem });
      continue;
    }
    resolved[key] = result.value;
  }

  if (issues.length > 0) throw new ConfigError(issues);
  return resolved as Resolved<S>;
}

/**
 * A representation safe to log or print: secrets are redacted rather than omitted, so the shape
 * of the configuration is still visible while the value is not.
 */
export function describe<S extends Schema>(schema: S, values: Resolved<S>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, spec] of Object.entries(schema)) {
    out[key] = spec.secret ? '<redacted>' : String(values[key as keyof Resolved<S>]);
  }
  return out;
}

/**
 * Every key in the schema, for generating `.env.example`. A key that exists in code but not in
 * `.env.example` is a documentation bug, and this is what makes that checkable.
 */
export function envKeys<S extends Schema>(schema: S): readonly string[] {
  return Object.values(schema)
    .map((spec) => spec.env)
    .sort();
}
