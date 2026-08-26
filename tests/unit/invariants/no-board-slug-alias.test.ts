/**
 * ADR-0040 rule 2's compliance check: **a board slug never becomes a company alias.**
 *
 * `uq_company_aliases__normalized` is global, so an alias is a claim over every source at once. A
 * board slug is a vendor's name for a tenant — store one as a name and a board called `apple`
 * resolves a small employer's entire listing onto Apple, with a row that looks exactly like a
 * correct one. That is the wrong merge `docs/database/entities/company.md` calls unrecoverable:
 * *"An unresolved company is a visible gap; a wrongly merged one is not."*
 *
 * ## Why this is a source scan and not an assertion about rows
 *
 * The obvious database test — *no `company_aliases` row whose `normalized` equals a configured board
 * slug* — **is not a true invariant and cannot be made one.** A board slug usually *is* the
 * employer's name: `normalizeCompanyAlias('Zoox, Inc.')` and `normalizeCompanyAlias('zoox')` are both
 * `zoox`. Asserting they never coincide fails on the first correct binding, which is what the first
 * draft of the integration test did.
 *
 * What is actually invariant is **provenance**: an alias exists because somebody curated a name, and
 * nothing that handles a scope may write one. That is a property of the code, so the code is what is
 * checked — the same reasoning, and the same bluntness, as `no-connector-dedup-key.test.ts`.
 *
 * Comments are stripped before scanning, so a module may *explain* that it does not write aliases.
 * Punishing the honest note is how a check gets deleted by whoever hits it next.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SCANNED = ['packages', 'services', 'connectors', 'ai', 'apps'];
const SKIPPED = new Set(['node_modules', 'dist', 'coverage', '.next']);

/** The one module ADR-0040 permits to write an alias, and it takes a curated name to do it. */
const ALIAS_WRITER = 'packages/db/src/repositories/companies.ts';

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (SKIPPED.has(entry)) continue;
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
      continue;
    }
    if (!/\.ts$/.test(entry) || /\.test\.ts$/.test(entry)) continue;
    found.push(full);
  }
  return found;
}

function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const files = SCANNED.flatMap((directory) => sourceFiles(join(ROOT, directory))).map((path) => ({
  relative: path.slice(ROOT.length).replace(/\\/g, '/'),
  text: code(readFileSync(path, 'utf8')),
}));

const writer = files.find((file) => file.relative === ALIAS_WRITER);

/** The body of one exported function, up to the next top-level `export`. */
function functionBody(text: string, name: string): string {
  const start = text.indexOf(`export async function ${name}`);
  if (start === -1) return '';
  const rest = text.slice(start + 1);
  const end = rest.indexOf('\nexport ');
  return end === -1 ? rest : rest.slice(0, end);
}

describe('a board slug never becomes a company alias', () => {
  it('reads the source tree, so an empty scan cannot pass', () => {
    expect(files.length).toBeGreaterThanOrEqual(100);
    expect(writer, `${ALIAS_WRITER} is where alias writes are permitted to live`).toBeDefined();
  });

  it('writes aliases from exactly one module', () => {
    const offenders = files
      .filter((file) => /insertInto\(\s*['"]company_aliases['"]/.test(file.text))
      .map((file) => file.relative);

    expect(offenders).toEqual([ALIAS_WRITER]);
  });

  it('still writes them there, so deleting the feature would not pass this file', () => {
    expect(functionBody(writer?.text ?? '', 'createCompany')).toContain("insertInto('company_aliases')");
  });

  it('never writes one from the code path that handles a board scope', () => {
    const binding = functionBody(writer?.text ?? '', 'bindBoardToCompany');

    expect(binding).not.toBe('');
    expect(binding, 'binding a board contributes nothing to the alias table').not.toContain('company_aliases');
  });

  it('never feeds a scope, slug or board into alias normalization', () => {
    const offenders = files
      .filter((file) => /normalizeCompanyAlias\(\s*[A-Za-z0-9_.]*(scope|slug|board)/i.test(file.text))
      .map((file) => file.relative);

    expect(offenders, 'an alias comes from a curated name, never from a namespace').toEqual([]);
  });
});
