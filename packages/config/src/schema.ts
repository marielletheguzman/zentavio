/**
 * The configuration schema DSL.
 *
 * Zero dependencies, deliberately. A validation library would be a new dependency and would need
 * an ADR (`.claude/context/tech-stack.md`); parsing strings into typed values does not justify
 * one. If configuration grows to need real schema composition, that is the moment to write the
 * ADR rather than now.
 */

export type ConfigValue = string | number | boolean;

interface SpecBase<T extends ConfigValue> {
  /** The environment variable name. */
  readonly env: string;
  readonly description: string;
  /**
   * A secret never appears in an error, a log, or a dump. `packages/config` is the only reader
   * of the environment, so this flag is the only place redaction can be guaranteed.
   */
  readonly secret?: boolean;
  /** Omit for a required value. A missing required value fails startup. */
  readonly default?: T;
}

export interface StringSpec extends SpecBase<string> {
  readonly type: 'string';
  readonly minLength?: number;
  /** Closed set. An out-of-set value is a startup failure, not a silent fallback. */
  readonly oneOf?: readonly string[];
}

export interface NumberSpec extends SpecBase<number> {
  readonly type: 'number';
  readonly min?: number;
  readonly max?: number;
  readonly integer?: boolean;
}

export interface BooleanSpec extends SpecBase<boolean> {
  readonly type: 'boolean';
}

export interface UrlSpec extends SpecBase<string> {
  readonly type: 'url';
  /** Restrict the scheme where it matters — an http URL for a secret endpoint is a mistake. */
  readonly protocols?: readonly string[];
}

export type Spec = StringSpec | NumberSpec | BooleanSpec | UrlSpec;
export type Schema = Readonly<Record<string, Spec>>;

/** The resolved type of a schema: `{ ollamaHost: string; poolSize: number }`. */
export type Resolved<S extends Schema> = {
  readonly [K in keyof S]: S[K] extends NumberSpec
    ? number
    : S[K] extends BooleanSpec
      ? boolean
      : string;
};

export interface ValidationIssue {
  readonly key: string;
  readonly env: string;
  readonly problem: string;
}

/** Truthy and falsy spellings people actually use, so `FLAG=1` does not silently mean false. */
const TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);
const FALSE_VALUES = new Set(['false', '0', 'no', 'off']);

function parseBoolean(raw: string): boolean | undefined {
  const normalized = raw.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return undefined;
}

/**
 * Parse and validate one value. Returns either the value or the problem — never throws, so the
 * loader can report every issue at once instead of one per restart.
 */
export function parseValue(
  spec: Spec,
  raw: string,
): { value: ConfigValue } | { problem: string } {
  switch (spec.type) {
    case 'string': {
      if (spec.minLength !== undefined && raw.length < spec.minLength) {
        return { problem: `must be at least ${spec.minLength} characters` };
      }
      if (spec.oneOf && !spec.oneOf.includes(raw)) {
        return { problem: `must be one of: ${spec.oneOf.join(', ')}` };
      }
      return { value: raw };
    }

    case 'number': {
      const trimmed = raw.trim();
      // Number('') is 0 and Number(' ') is 0, which would silently accept an empty variable.
      if (trimmed === '') return { problem: 'must be a number, got an empty value' };
      const value = Number(trimmed);
      if (!Number.isFinite(value)) return { problem: `must be a number, got "${raw}"` };
      if (spec.integer && !Number.isInteger(value)) return { problem: 'must be an integer' };
      if (spec.min !== undefined && value < spec.min) return { problem: `must be >= ${spec.min}` };
      if (spec.max !== undefined && value > spec.max) return { problem: `must be <= ${spec.max}` };
      return { value };
    }

    case 'boolean': {
      const value = parseBoolean(raw);
      if (value === undefined) {
        return { problem: `must be one of: ${[...TRUE_VALUES, ...FALSE_VALUES].join(', ')}` };
      }
      return { value };
    }

    case 'url': {
      let parsed: URL;
      try {
        parsed = new URL(raw);
      } catch {
        return { problem: 'must be an absolute URL' };
      }
      if (spec.protocols && !spec.protocols.includes(parsed.protocol.replace(':', ''))) {
        return { problem: `must use one of: ${spec.protocols.join(', ')}` };
      }
      return { value: raw };
    }
  }
}
