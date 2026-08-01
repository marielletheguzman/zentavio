/**
 * Reading `packages/db/src/schema.ts` as data.
 *
 * The `Database` interface is **parsed**, not mirrored. A hand-kept runtime copy of the table list
 * would only move the drift somewhere else — the copy and the interface would be the two things out
 * of step. TypeScript is already a devDependency, so its own parser reads the real declaration.
 *
 * Extracted from `schema-drift.test.ts` when `migrations.test.ts` turned out to hardcode its own
 * table list under the title "creates the tables the Database interface declares". It did not check
 * the interface; it checked a literal that had to be edited by hand on every migration, and would
 * have gone stale silently the first time someone forgot. Two tests, one parser, no literal.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SCHEMA_PATH = fileURLToPath(new URL('../../../packages/db/src/schema.ts', import.meta.url));

export interface DeclaredColumn {
  readonly name: string;
  readonly nullable: boolean;
  /** `Generated<T>` in Kysely means the database supplies it when the insert omits it. */
  readonly hasDefault: boolean;
}

export type DeclaredTables = ReadonlyMap<string, readonly DeclaredColumn[]>;

/**
 * Read `schema.ts` and return the tables `Database` declares.
 *
 * Deliberately syntactic: no type checker, no program construction. The `Database` interface maps a
 * table name to an interface name, and that interface's members are the columns. Anything more
 * clever would be a second implementation of TypeScript's resolution rules.
 */
export function parseDeclaredTables(): DeclaredTables {
  const source = ts.createSourceFile(
    SCHEMA_PATH,
    readFileSync(SCHEMA_PATH, 'utf8'),
    ts.ScriptTarget.ES2022,
    true,
  );

  const interfaces = new Map<string, ts.InterfaceDeclaration>();
  source.forEachChild((node) => {
    if (ts.isInterfaceDeclaration(node)) interfaces.set(node.name.text, node);
  });

  const database = interfaces.get('Database');
  if (!database) throw new Error(`no Database interface found in ${SCHEMA_PATH}`);

  const tables = new Map<string, readonly DeclaredColumn[]>();

  for (const member of database.members) {
    if (!ts.isPropertySignature(member) || !member.type) continue;
    const tableName = member.name.getText();
    const interfaceName = member.type.getText();

    const declaration = interfaces.get(interfaceName);
    if (!declaration) {
      throw new Error(`Database.${tableName} refers to ${interfaceName}, which is not declared here`);
    }

    const columns: DeclaredColumn[] = [];
    for (const property of declaration.members) {
      if (!ts.isPropertySignature(property) || !property.type) continue;
      const type = property.type.getText();
      columns.push({
        name: property.name.getText(),
        // Union with null is how an optional column is spelled throughout that file.
        nullable: /\|\s*null\b/.test(type),
        hasDefault: type.startsWith('Generated<'),
      });
    }
    tables.set(tableName, columns);
  }

  return tables;
}
