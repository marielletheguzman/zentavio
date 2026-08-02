import { describe, expect, it } from 'vitest';
import { ConfigError, describe as describeConfig, envKeys, load } from './load.ts';
import type { Schema } from './schema.ts';
import { zentavioSchema } from './zentavio.ts';

// The properties under test are behavioural, not cosmetic: a missing required value must stop
// startup, every problem must be reported at once, and a secret must never reach a message.

const schema = {
  host: {
    env: 'TEST_HOST',
    type: 'url',
    protocols: ['http', 'https'],
    default: 'http://localhost:1234',
    description: 'a host',
  },
  poolSize: {
    env: 'TEST_POOL',
    type: 'number',
    integer: true,
    min: 1,
    max: 100,
    default: 10,
    description: 'pool size',
  },
  apiKey: {
    env: 'TEST_KEY',
    type: 'string',
    minLength: 8,
    secret: true,
    description: 'an api key',
  },
  debug: { env: 'TEST_DEBUG', type: 'boolean', default: false, description: 'debug' },
  mode: {
    env: 'TEST_MODE',
    type: 'string',
    oneOf: ['fast', 'thorough'],
    default: 'fast',
    description: 'mode',
  },
} as const satisfies Schema;

const valid = { TEST_KEY: 'longenoughkey' };

describe('startup validation', () => {
  it('fails when a required value is missing', () => {
    // The point of validating at startup: this must not become a runtime surprise later.
    expect(() => load(schema, {})).toThrow(ConfigError);
  });

  it('names the environment variable and the reason', () => {
    try {
      load(schema, {});
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const message = (error as ConfigError).message;
      expect(message).toContain('TEST_KEY');
      expect(message).toContain('required but not set');
      expect(message).toContain('an api key');
    }
  });

  it('reports every problem at once rather than one per restart', () => {
    try {
      load(schema, { TEST_KEY: 'short', TEST_POOL: 'not-a-number', TEST_HOST: 'not-a-url' });
      expect.unreachable('should have thrown');
    } catch (error) {
      const issues = (error as ConfigError).issues;
      expect(issues).toHaveLength(3);
      expect(issues.map((i) => i.env).sort()).toEqual(['TEST_HOST', 'TEST_KEY', 'TEST_POOL']);
    }
  });

  it('treats an empty string as unset', () => {
    // VAR= in a .env file is a common way to mean "not set", and silently accepting "" as a
    // valid value is how an empty credential reaches a client.
    expect(() => load(schema, { TEST_KEY: '' })).toThrow(ConfigError);
    expect(load(schema, { ...valid, TEST_MODE: '' }).mode).toBe('fast');
  });
});

describe('defaults', () => {
  it('applies them when a value is unset', () => {
    const config = load(schema, valid);
    expect(config.host).toBe('http://localhost:1234');
    expect(config.poolSize).toBe(10);
    expect(config.debug).toBe(false);
  });

  it('lets the environment override them', () => {
    const config = load(schema, { ...valid, TEST_POOL: '25', TEST_DEBUG: 'true' });
    expect(config.poolSize).toBe(25);
    expect(config.debug).toBe(true);
  });
});

describe('parsing', () => {
  it('returns a number rather than a string', () => {
    const config = load(schema, { ...valid, TEST_POOL: '25' });
    expect(config.poolSize).toBe(25);
    expect(typeof config.poolSize).toBe('number');
  });

  it('rejects a non-integer where an integer is required', () => {
    expect(() => load(schema, { ...valid, TEST_POOL: '2.5' })).toThrow(/integer/);
  });

  it('enforces bounds', () => {
    expect(() => load(schema, { ...valid, TEST_POOL: '0' })).toThrow(/>= 1/);
    expect(() => load(schema, { ...valid, TEST_POOL: '101' })).toThrow(/<= 100/);
  });

  it('does not accept an empty or whitespace value as the number zero', () => {
    // Number(' ') is 0, which would silently produce a pool size of zero.
    expect(() => load(schema, { ...valid, TEST_POOL: '   ' })).toThrow(ConfigError);
  });

  it.each([
    ['true', true],
    ['1', true],
    ['yes', true],
    ['on', true],
    ['TRUE', true],
    ['false', false],
    ['0', false],
    ['no', false],
    ['off', false],
  ])('parses the boolean spelling %s', (raw, expected) => {
    expect(load(schema, { ...valid, TEST_DEBUG: raw }).debug).toBe(expected);
  });

  it('rejects an unrecognised boolean rather than guessing', () => {
    // The failure this avoids: TEST_DEBUG=maybe quietly meaning false.
    expect(() => load(schema, { ...valid, TEST_DEBUG: 'maybe' })).toThrow(ConfigError);
  });

  it('rejects a value outside a closed set', () => {
    expect(() => load(schema, { ...valid, TEST_MODE: 'medium' })).toThrow(/fast, thorough/);
  });

  it('rejects a URL with a disallowed protocol', () => {
    expect(() => load(schema, { ...valid, TEST_HOST: 'ftp://example.invalid' })).toThrow(
      /http, https/,
    );
  });

  it('rejects a relative URL', () => {
    expect(() => load(schema, { ...valid, TEST_HOST: '/local' })).toThrow(/absolute URL/);
  });
});

describe('secrets', () => {
  it('never includes the value in an error message', () => {
    try {
      load(schema, { TEST_KEY: 'short' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ConfigError).message).not.toContain('short');
    }
  });

  it('redacts the value in a describable form', () => {
    const config = load(schema, { ...valid, TEST_POOL: '25' });
    const described = describeConfig(schema, config);

    expect(described.apiKey).toBe('<redacted>');
    // Non-secrets stay visible, so the shape of the configuration is still legible.
    expect(described.poolSize).toBe('25');
  });
});

describe('the Zentavio schema', () => {
  it('fails with no environment set, because the database url has no default', () => {
    // Deliberate: a plausible-but-wrong default is how migrations reach the wrong database.
    expect(() => load(zentavioSchema, {})).toThrow(/ZENTAVIO_DATABASE_URL/);
  });

  it('loads once the database url is supplied', () => {
    const config = load(zentavioSchema, {
      ZENTAVIO_DATABASE_URL: 'postgresql://localhost/z',
      ZENTAVIO_RESUME_PARSER_URL: 'http://127.0.0.1:8001',
      ZENTAVIO_SKILL_GAP_URL: 'http://127.0.0.1:8002',
    });
    expect(config.ollamaHost).toBe('http://127.0.0.1:11434');
    expect(config.databaseMaxConnections).toBe(10);
  });

  it('never leaks the database url into an error', () => {
    // It carries credentials, so it is marked secret.
    try {
      load(zentavioSchema, { ZENTAVIO_DATABASE_URL: '', ZENTAVIO_DATABASE_MAX_CONNECTIONS: 'x' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as Error).message).not.toContain('postgresql://');
    }
  });

  it('pins the defaults that the Python side duplicates', () => {
    // ADR-0003's accepted cost: these two are duplicated in ai/shared/evals/model.py, which is
    // stdlib-only and cannot import from here. This test pins the TypeScript values; it cannot
    // see the Python ones. The actual drift check is
    // ai/shared/evals/tests/test_config_parity.py, which parses this schema and compares.
    const config = load(zentavioSchema, {
      ZENTAVIO_DATABASE_URL: 'postgresql://localhost/z',
      ZENTAVIO_RESUME_PARSER_URL: 'http://127.0.0.1:8001',
      ZENTAVIO_SKILL_GAP_URL: 'http://127.0.0.1:8002',
    });
    expect(config.ollamaHost).toBe('http://127.0.0.1:11434');
    expect(config.evalModel).toBe('qwen2.5:14b-instruct');
  });

  it('exposes every key for generating .env.example', () => {
    expect(envKeys(zentavioSchema)).toEqual([
      'NODE_ENV',
      'OLLAMA_HOST',
      'ZENTAVIO_DATABASE_CONNECTION_TIMEOUT_MS',
      'ZENTAVIO_DATABASE_MAX_CONNECTIONS',
      'ZENTAVIO_DATABASE_URL',
      'ZENTAVIO_EVAL_MODEL',
      // ADR-0003: where services/api-gateway reaches ai/resume-parser. No default, for the same
      // reason as the database url — a plausible-but-wrong default fails silently against the
      // wrong host.
      'ZENTAVIO_INSECURE_DEV_AUTH',
      'ZENTAVIO_OIDC_AUDIENCE',
      'ZENTAVIO_OIDC_ISSUER',
      // ADR-0018: the parser's model-backed steps. Both have defaults, because a deployment with
      // no model still produces a complete deterministic profile and says enrichment did not run.
      'ZENTAVIO_PARSER_ENRICHMENT',
      'ZENTAVIO_PARSER_MODEL',
      'ZENTAVIO_RESUME_PARSER_URL',
      'ZENTAVIO_SKILL_GAP_URL',
    ]);
  });
});
