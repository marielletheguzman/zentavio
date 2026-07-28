import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The audit script is what stops a boundary rule from being silenced by an inline comment
// (ADR-0005). CI depends on its exit code, so that contract is what these tests assert —
// invoked as a subprocess in a temporary tree, rather than by importing internals.

const SCRIPT = join(process.cwd(), 'tools', 'scripts', 'audit-boundary-disables.mjs');

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runAudit(cwd: string): RunResult {
  try {
    const stdout = execFileSync('node', [SCRIPT], { cwd, encoding: 'utf8' });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

describe('boundary-disable audit', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'zentavio-audit-'));
    mkdirSync(join(dir, 'src'), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('exits 0 when no boundary rule is suppressed', () => {
    writeFileSync(join(dir, 'src', 'clean.ts'), 'export const x = 1;\n');

    const result = runAudit(dir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('clean');
  });

  it('exits 1 and names the file when a boundary rule is suppressed', () => {
    writeFileSync(
      join(dir, 'src', 'sneaky.ts'),
      '// eslint-disable-next-line boundaries/element-types\nimport { x } from "../../services/a";\n',
    );

    const result = runAudit(dir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('src/sneaky.ts');
    expect(result.stderr).toContain('boundaries/element-types');
  });

  // Each disable form is a separate way to silence the rule, so each is asserted rather
  // than assumed to be covered by the regex.
  it.each([
    ['line comment', '// eslint-disable-line boundaries/no-unknown'],
    ['next-line comment', '// eslint-disable-next-line boundaries/element-types'],
    ['block disable', '/* eslint-disable boundaries/element-types */'],
    ['inline block', 'const a = 1; /* eslint-disable-line boundaries/no-unknown-files */'],
  ])('detects a %s', (_label, comment) => {
    writeFileSync(join(dir, 'src', 'v.ts'), `${comment}\nexport const y = 2;\n`);

    expect(runAudit(dir).status).toBe(1);
  });

  it('ignores a disable of an unrelated rule', () => {
    writeFileSync(
      join(dir, 'src', 'other.ts'),
      '// eslint-disable-next-line @typescript-eslint/no-explicit-any\nexport const z: any = 3;\n',
    );

    // Only boundary suppressions are architecture exceptions. Everything else is ordinary
    // lint noise and is not this script's business.
    expect(runAudit(dir).status).toBe(0);
  });

  it('does not descend into node_modules', () => {
    mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(
      join(dir, 'node_modules', 'pkg', 'index.js'),
      '/* eslint-disable boundaries/element-types */\n',
    );

    expect(runAudit(dir).status).toBe(0);
  });

  it('scans nested directories, not just the top level', () => {
    mkdirSync(join(dir, 'a', 'b', 'c'), { recursive: true });
    writeFileSync(
      join(dir, 'a', 'b', 'c', 'deep.ts'),
      '/* eslint-disable boundaries/element-types */\n',
    );

    const result = runAudit(dir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('a/b/c/deep.ts');
  });
});
