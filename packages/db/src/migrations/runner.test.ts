import { describe, expect, it } from 'vitest';
import {
  MigrationError,
  checksum,
  isNonTransactional,
  migrate,
  plan,
  type MigrationExecutor,
  type MigrationFile,
} from './runner.js';

// ADR-0012 makes this runner ours to maintain, so its failure modes are ours too. These tests are
// about the ways a migration set corrupts a database — out-of-order application, an edited file,
// a vanished file — not about SQL, which needs PostgreSQL and is tested separately.

const file = (id: string, sql = `-- ${id}\nSELECT 1;`): MigrationFile => ({ id, sql });

/** Records what was asked of it, so ordering and transaction use are assertable. */
function fakeExecutor(
  applied: string[] = [],
  checksums: Map<string, string> = new Map(),
): MigrationExecutor & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    async execute(sql) {
      log.push(`execute:${sql.split('\n')[0]}`);
    },
    async withTransaction(fn) {
      log.push('begin');
      const result = await fn();
      log.push('commit');
      return result;
    },
    async appliedIds() {
      return [...applied];
    },
    async recordApplied(id, sum) {
      applied.push(id);
      checksums.set(id, sum);
      log.push(`record:${id}`);
    },
    async appliedChecksums() {
      return new Map(checksums);
    },
  };
}

describe('checksum', () => {
  it('changes when the content changes', () => {
    expect(checksum('SELECT 1;')).not.toBe(checksum('SELECT 2;'));
  });

  it('is stable across line-ending styles', () => {
    // A Windows checkout must not look like every migration was edited.
    expect(checksum('a\r\nb\r\n')).toBe(checksum('a\nb\n'));
  });
});

describe('non-transactional detection', () => {
  it.each([
    'CREATE INDEX CONCURRENTLY idx_a ON t (c);',
    'create unique index concurrently idx_b ON t (c);',
    'DROP INDEX CONCURRENTLY idx_c;',
  ])('detects %s', (sql) => {
    expect(isNonTransactional(sql)).toBe(true);
  });

  it('does not flag an ordinary index', () => {
    expect(isNonTransactional('CREATE INDEX idx_a ON t (c);')).toBe(false);
  });

  it('matches on the statement rather than a filename convention', () => {
    // A file cannot claim transactional safety it does not have, or vice versa.
    expect(isNonTransactional('ALTER TABLE t ADD COLUMN c text;')).toBe(false);
  });
});

describe('plan', () => {
  it('returns pending migrations in order', () => {
    const entries = plan([file('0002-b'), file('0001-a')], []);
    expect(entries.map((e) => e.id)).toEqual(['0001-a', '0002-b']);
  });

  it('skips already-applied migrations', () => {
    expect(plan([file('0001-a'), file('0002-b')], ['0001-a']).map((e) => e.id)).toEqual(['0002-b']);
  });

  it('is empty when everything is applied', () => {
    expect(plan([file('0001-a')], ['0001-a'])).toEqual([]);
  });

  it('refuses a migration ordered before the last applied one', () => {
    // Two branches merged with interleaved timestamps. Applying it now produces a schema no fresh
    // database would ever reach.
    expect(() => plan([file('0001-a'), file('0003-c')], ['0003-c'])).toThrow(
      /ordered before the last applied one/,
    );
  });

  it('names the offending migration and the last applied one', () => {
    try {
      plan([file('0001-a'), file('0003-c')], ['0003-c']);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as MigrationError).message).toContain('0001-a');
      expect((error as MigrationError).message).toContain('0003-c');
    }
  });

  it('refuses an applied migration that was edited afterwards', () => {
    // What ran is not what the file says, so every fresh database now differs from every existing
    // one. Fix forward, never edit.
    const checksums = new Map([['0001-a', checksum('-- 0001-a\nSELECT 1;')]]);
    expect(() =>
      plan([file('0001-a', '-- 0001-a\nSELECT 2;')], ['0001-a'], checksums),
    ).toThrow(/edited after being applied/);
  });

  it('accepts an applied migration whose content is unchanged', () => {
    const sql = '-- 0001-a\nSELECT 1;';
    expect(() => plan([file('0001-a', sql)], ['0001-a'], new Map([['0001-a', checksum(sql)]]))).not.toThrow();
  });

  it('refuses when an applied migration has no file', () => {
    expect(() => plan([file('0002-b')], ['0001-a'])).toThrow(/no file/);
  });

  it('refuses duplicate ids', () => {
    expect(() => plan([file('0001-a'), file('0001-a')], [])).toThrow(/duplicate migration id/);
  });

  it('tolerates an unrecorded checksum for an older applied migration', () => {
    // Migrations applied before checksums were recorded must not block every later run.
    expect(() => plan([file('0001-a')], ['0001-a'], new Map())).not.toThrow();
  });
});

describe('migrate', () => {
  it('applies pending migrations in order and records each', async () => {
    const executor = fakeExecutor();
    const result = await migrate([file('0002-b'), file('0001-a')], executor);

    expect(result.applied).toEqual(['0001-a', '0002-b']);
    expect(executor.log).toEqual([
      'begin',
      'execute:-- 0001-a',
      'record:0001-a',
      'commit',
      'begin',
      'execute:-- 0002-b',
      'record:0002-b',
      'commit',
    ]);
  });

  it('is idempotent — a second run applies nothing', async () => {
    const applied: string[] = [];
    const checksums = new Map<string, string>();
    const files = [file('0001-a')];

    await migrate(files, fakeExecutor(applied, checksums));
    const second = await migrate(files, fakeExecutor(applied, checksums));

    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(['0001-a']);
  });

  it('wraps an ordinary migration in a transaction', async () => {
    const executor = fakeExecutor();
    await migrate([file('0001-a', 'ALTER TABLE t ADD COLUMN c text;')], executor);

    expect(executor.log[0]).toBe('begin');
    expect(executor.log.at(-1)).toBe('commit');
  });

  it('runs a CONCURRENTLY migration outside a transaction', async () => {
    // PostgreSQL forbids it inside one, so this is a constraint rather than a preference.
    const executor = fakeExecutor();
    await migrate([file('0001-a', 'CREATE INDEX CONCURRENTLY idx ON t (c);')], executor);

    expect(executor.log).not.toContain('begin');
    expect(executor.log).toContain('record:0001-a');
  });

  it('stops at the first failure rather than continuing', async () => {
    const executor = fakeExecutor();
    let calls = 0;
    executor.execute = async () => {
      calls += 1;
      if (calls === 1) throw new Error('syntax error at or near "SELCT"');
    };

    await expect(migrate([file('0001-a'), file('0002-b')], executor)).rejects.toThrow(
      /syntax error/,
    );
    // The second migration must not run against a schema the first failed to produce.
    expect(calls).toBe(1);
  });
});
