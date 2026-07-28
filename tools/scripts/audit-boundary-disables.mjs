#!/usr/bin/env node
// Boundary-disable audit — ADR-0005 compliance.
//
// eslint-plugin-boundaries is advisory: an author can silence it with an inline
// disable comment. That is the one hole in the enforcement, so it is audited
// explicitly. A boundary disable is an architecture exception and needs an ADR.
//
// Exits non-zero on any hit. Wire into CI alongside `pnpm lint`.

import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', 'coverage', '.turbo']);
const SOURCE_EXT = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;

// Matches any eslint disable form (line, next-line, block, enable) that names a
// boundaries rule.
const DISABLE = /eslint-disable(?:-next-line|-line)?[^\n]*\bboundaries\/[\w-]+/;

/** @returns {AsyncGenerator<string>} */
async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(join(dir, entry.name));
    } else if (SOURCE_EXT.test(entry.name)) {
      yield join(dir, entry.name);
    }
  }
}

const hits = [];

for await (const file of walk(ROOT)) {
  // The audit script names the rules it looks for, so it would match itself.
  if (file.endsWith(join('tools', 'scripts', 'audit-boundary-disables.mjs'))) continue;

  const lines = (await readFile(file, 'utf8')).split('\n');
  lines.forEach((line, i) => {
    if (DISABLE.test(line)) {
      hits.push({ file: relative(ROOT, file).split(sep).join('/'), line: i + 1, text: line.trim() });
    }
  });
}

if (hits.length === 0) {
  console.log('boundaries audit: clean — no layer rule is being suppressed.');
  process.exit(0);
}

console.error(`boundaries audit: ${hits.length} suppressed layer rule(s).\n`);
for (const hit of hits) {
  console.error(`  ${hit.file}:${hit.line}`);
  console.error(`    ${hit.text}\n`);
}
console.error(
  'A boundary disable is an architecture exception, not a lint workaround.\n' +
    'Either fix the dependency direction (usually: declare an interface in the inner\n' +
    'layer and inject the implementation from the outer one), or write an ADR in\n' +
    'docs/architecture/decisions/ justifying the exception and reference it here.\n' +
    'See .claude/skills/architecture/SKILL.md and ADR-0005.',
);
process.exit(1);
