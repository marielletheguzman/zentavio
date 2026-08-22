/**
 * ADR-0034's compliance check: **no connector computes a deduplication key.**
 *
 * Deduplication is the claim that two postings from two feeds are the same job. A connector sees one
 * feed, so the only key it can produce is either a restatement of its own identity — which
 * persistence already has — or a guess about an employer it was never told. The Lever case is the
 * proof: the guide's formula needs a company name, a Lever board publishes none, and the three ways
 * to satisfy it anyway are all inventions ADR-0033 forbids.
 *
 * It reads source text, which is blunt. It is here anyway because the failure it catches is somebody
 * adding a helpful `dedupKey()` to a connector — no type, constraint or lint rule would notice, and
 * the resulting key would look exactly like a real one in the database.
 *
 * Comments are stripped before scanning, so a connector may *explain* that deduplication is not its
 * job. Punishing the honest note is how a check gets deleted by whoever hits it next.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CONNECTORS = join(ROOT, 'connectors');

const SKIPPED = new Set(['node_modules', 'dist', 'coverage']);

/** What a key derivation looks like, whatever it is named. */
const DEDUPLICATION = /dedup|dedupe|deduplicat/i;

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (SKIPPED.has(entry)) continue;
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
      continue;
    }
    if (!/\.ts$/.test(entry)) continue;
    found.push(full);
  }
  return found;
}

/** A doc comment saying deduplication happens elsewhere is not a key derivation. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const files = sourceFiles(CONNECTORS).map((path) => ({
  relative: path.slice(ROOT.length).replace(/\\/g, '/'),
  text: code(readFileSync(path, 'utf8')),
}));

describe('deduplication belongs to persistence', () => {
  it('reads the connector sources, so an empty scan cannot pass', () => {
    expect(files.length).toBeGreaterThanOrEqual(20);
  });

  it('finds no key derivation in any connector', () => {
    const offenders = files.filter((file) => DEDUPLICATION.test(file.text)).map((file) => file.relative);

    expect(offenders, 'a connector sees one source and cannot claim two postings are one job').toEqual([]);
  });

  it('leaves the derivation where the cross-source data is', () => {
    // The counterpart to the negative above: asserting only the absence would pass just as well if
    // deduplication had been deleted entirely.
    const repository = readFileSync(join(ROOT, 'packages', 'db', 'src', 'repositories', 'jobs.ts'), 'utf8');

    expect(repository).toContain('export function dedupKeyFor');
    expect(repository).toContain('source-identity');
  });
});
