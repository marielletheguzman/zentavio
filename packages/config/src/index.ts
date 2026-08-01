/**
 * `@zentavio/config` — the only reader of the environment.
 *
 * `process.env` anywhere else fails the build (`no-restricted-syntax` in `eslint.config.mjs`,
 * ADR-0005). Untyped configuration read at ten call sites is how a service ends up with three
 * different defaults for one value, and how a missing variable becomes a runtime surprise instead
 * of a startup failure.
 *
 * ```ts
 * import { load, zentavioSchema } from '@zentavio/config';
 *
 * const config = load(zentavioSchema);   // throws ConfigError on any problem
 * ```
 */

export { ConfigError, describe, envKeys, load } from './load.ts';
export { parseValue } from './schema.ts';
export type {
  BooleanSpec,
  ConfigValue,
  NumberSpec,
  Resolved,
  Schema,
  Spec,
  StringSpec,
  UrlSpec,
  ValidationIssue,
} from './schema.ts';
export {
  databaseSchema,
  devAuthSchema,
  evalSchema,
  oidcSchema,
  parserSchema,
  testDatabaseSchema,
  zentavioSchema,
  type ZentavioConfig,
} from './zentavio.ts';
