/**
 * Explicit injection tokens.
 *
 * Nest can infer a dependency from a constructor's parameter type via `emitDecoratorMetadata`, and
 * that inference is fragile in exactly the ways this codebase invites: a `import type { Kysely }`
 * erases to `Function` and the container fails at boot with "argument Function at index [0]", which
 * names neither the file nor the real cause. It cost a boot failure here before these existed.
 *
 * Symbols also make the seam explicit — `DATABASE` is a port, not "whatever class happens to be
 * imported".
 */

export const DATABASE = Symbol('DATABASE');
export const PARSER_CLIENT = Symbol('PARSER_CLIENT');
export const SUBJECT_RESOLVER = Symbol('SUBJECT_RESOLVER');
export const GAP_CLIENT = Symbol('GAP_CLIENT');
export const ELIGIBILITY_CLIENT = Symbol('ELIGIBILITY_CLIENT');
