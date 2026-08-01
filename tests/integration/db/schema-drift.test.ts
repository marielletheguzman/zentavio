/**
 * The `Database` interface against the live schema.
 *
 * ADR-0012 named this as the one real weakness of choosing a hand-written interface over a generated
 * client: `packages/db/src/schema.ts` can drift from the migrations, and a drifted interface
 * typechecks perfectly and then fails at runtime. The ADR's answer was "a mechanism rather than a
 * convention", and this is the mechanism.
 *
 * The interface is **parsed**, not mirrored. A hand-kept runtime copy of the table list would only
 * move the drift somewhere else — the copy and the interface would be the two things out of step.
 * TypeScript is already a devDependency, so its own parser reads the real declaration.
 *
 * **What this compares:** table names, column names, nullability, and whether a column has a default.
 * **What it does not:** exact SQL types. `text` versus `varchar`, or `numeric(5,4)` versus
 * `numeric(14,2)`, is not knowable from `string` — Kysely's types describe the shape TypeScript sees,
 * not the column's declaration. Drift in practice is a column added, removed, renamed, or made
 * nullable, and those are caught here. Claiming more would be claiming something untrue.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { migratedTestPool } from './database.ts';
import { parseDeclaredTables, type DeclaredTables } from './declared-schema.ts';

interface ActualColumn {
  column_name: string;
  is_nullable: 'YES' | 'NO';
  column_default: string | null;
  identity_generation: string | null;
}

let pool: Pool;
let declared: DeclaredTables;

beforeAll(async () => {
  pool = await migratedTestPool();
  declared = parseDeclaredTables();
});

afterAll(async () => {
  await pool?.end();
});

describe('schema drift', () => {
  it('declares every table that exists, and no table that does not', async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name`,
    );

    // Both directions matter. A table the interface invents typechecks and fails at runtime; a table
    // it does not know about is a table no repository can reach.
    expect([...declared.keys()].sort()).toEqual(rows.map((r) => r.table_name));
  });

  it('declares exactly the columns each table has', async () => {
    for (const [table, columns] of declared) {
      const { rows } = await pool.query<ActualColumn>(
        `SELECT column_name, is_nullable, column_default, identity_generation
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1
          ORDER BY column_name`,
        [table],
      );

      const actualNames = rows.map((r) => r.column_name);
      const declaredNames = columns.map((c) => c.name).sort();
      // Named per table so a failure says which one, rather than dumping one merged diff.
      expect({ table, columns: declaredNames }).toEqual({ table, columns: actualNames });
    }
  });

  it('agrees with the database about which columns are nullable', async () => {
    for (const [table, columns] of declared) {
      const { rows } = await pool.query<ActualColumn>(
        `SELECT column_name, is_nullable, column_default, identity_generation
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1`,
        [table],
      );
      const actual = new Map(rows.map((r) => [r.column_name, r]));

      for (const column of columns) {
        const row = actual.get(column.name);
        if (!row) continue; // the previous test owns missing columns
        expect({ table, column: column.name, nullable: column.nullable }).toEqual({
          table,
          column: column.name,
          nullable: row.is_nullable === 'YES',
        });
      }
    }
  });

  it('marks Generated<> exactly where the database supplies a value', async () => {
    for (const [table, columns] of declared) {
      const { rows } = await pool.query<ActualColumn>(
        `SELECT column_name, is_nullable, column_default, identity_generation
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1`,
        [table],
      );
      const actual = new Map(rows.map((r) => [r.column_name, r]));

      for (const column of columns) {
        const row = actual.get(column.name);
        if (!row) continue;
        // Getting this wrong is a runtime error at the first insert that omits the column, or a
        // required argument that need not have been required. Neither shows up in a typecheck.
        const supplied = row.column_default !== null || row.identity_generation !== null;
        expect({ table, column: column.name, hasDefault: column.hasDefault }).toEqual({
          table,
          column: column.name,
          hasDefault: supplied,
        });
      }
    }
  });
});

describe('the drift parser itself', () => {
  it('found the tables it was meant to read', () => {
    // If the parser silently returned nothing, every test above would pass vacuously.
    expect([...declared.keys()]).toContain('requirements');
    expect([...declared.keys()]).toContain('users');
    expect(declared.get('users')?.length).toBeGreaterThan(5);
  });

  it('reads nullability and defaults off the declaration, not off the database', () => {
    const users = declared.get('users') ?? [];
    const byName = new Map(users.map((c) => [c.name, c]));

    expect(byName.get('email')).toEqual({ name: 'email', nullable: false, hasDefault: false });
    expect(byName.get('deleted_at')).toEqual({
      name: 'deleted_at',
      nullable: true,
      hasDefault: false,
    });
    expect(byName.get('locale')).toEqual({ name: 'locale', nullable: false, hasDefault: true });
  });
});
