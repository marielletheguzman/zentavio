/**
 * ADR-0023's compliance check: **Tailwind's own design system is disabled, not inherited.**
 *
 * The ADR's deciding argument is that the token layer should *generate* the vocabulary, so that
 * "no colour outside the design system" stops being review discipline and becomes a build-time
 * fact. That is only true if the stock scales are actually gone. Extending is Tailwind's default
 * and emptying a namespace takes a deliberate `--namespace-*: initial`, so the failure mode here is
 * a silent one: `bg-red-500` keeps working, nobody notices, and the second vocabulary the ADR
 * exists to prevent is already in the tree.
 *
 * ## What this file can and cannot assert
 *
 * ADR-0023's compliance section asks for a test that compiles `bg-red-500`, `p-[13px]` and
 * `text-[#b91c1c]` and asserts **no matching CSS is produced**. Two of those three are assertable
 * and one is not:
 *
 * - **Stock scales** are configuration. Emptying the namespace genuinely produces nothing, and that
 *   is what the first three tests below check.
 * - **Arbitrary values** are not configuration. `p-[13px]` is part of Tailwind's grammar and there
 *   is no setting in v4 that turns it off — the compiler will always emit `padding: 13px`. The
 *   ADR's own consequences section says as much: *"the arbitrary-value syntax is a permanent hole
 *   in the off-scale rule unless linted."* The compliance bullet and the consequences section
 *   disagree, and the consequences section is the one that matches the tool.
 *
 * So the hole is closed where it can be closed — in `eslint.config.mjs`, which reads the source
 * rather than the compiler output. `arbitraryValuesStillCompile` below documents that boundary by
 * asserting the thing the ADR hoped was false, so nobody re-reads the compliance bullet in a year
 * and concludes this test was written wrong.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compile } from 'tailwindcss';
import { beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const TOKENS = fileURLToPath(new URL('./tokens.css', import.meta.url));

/**
 * Resolution for the two shapes of `@import` a Tailwind entrypoint uses: relative, which
 * `tailwindcss/index.css` uses for its own three parts, and bare, which names a package.
 */
async function loadStylesheet(id: string, base: string) {
  const path = id.startsWith('.')
    ? resolve(base, id)
    : require.resolve(id.endsWith('.css') ? id : `${id}/index.css`);

  return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
}

/**
 * The real entrypoint, not a fixture standing in for one.
 *
 * `apps/web/app/globals.css` imports these two in this order, so compiling anything else would be
 * testing a stylesheet nobody ships.
 */
const ENTRYPOINT = `@import 'tailwindcss';\n@import '${TOKENS.split('\\').join('/')}';\n`;

let build: (candidates: string[]) => string;

beforeAll(async () => {
  const compiler = await compile(ENTRYPOINT, {
    base: dirname(TOKENS),
    loadStylesheet,
  });
  build = (candidates) => compiler.build(candidates);
});

/**
 * Whether a candidate produced a rule of its own.
 *
 * Tailwind emits preflight, `@property` declarations and the theme's custom properties regardless
 * of what was requested, so "the output is non-empty" proves nothing. What proves it is the
 * candidate's own escaped selector appearing in the output.
 */
function generates(candidate: string): boolean {
  const escaped = candidate.replace(/[[\]#().,%/:]/g, (character) => `\\${character}`);
  return build([candidate]).includes(`.${escaped}`);
}

describe("Tailwind's stock scales are disabled, not extended", () => {
  it.each([
    ['bg-red-500', 'stock palette'],
    ['text-blue-600', 'stock palette'],
    ['border-slate-300', 'stock palette'],
    ['bg-white', 'stock palette — the one that looks harmless and is not'],
    ['text-4xl', 'stock type scale'],
    ['text-9xl', 'stock type scale'],
    ['rounded-xl', 'stock radius scale'],
    ['rounded-2xl', 'stock radius scale'],
    ['shadow-lg', 'stock elevation scale'],
    ['shadow-2xl', 'stock elevation scale'],
    ['font-mono', 'stock font stack'],
    ['font-serif', 'stock font stack'],
  ])('%s generates nothing (%s)', (candidate) => {
    expect(generates(candidate)).toBe(false);
  });
});

describe('spacing is a discrete scale, not a multiplier', () => {
  /**
   * The subtle half of the same rule.
   *
   * Tailwind v4's default `--spacing` turns every integer into a valid step, so `p-7` would compile
   * to 1.75rem — a value the 4px scale in `ui-guidelines.md` does not contain, produced by default,
   * with nothing in the diff to notice. Declaring the eight steps individually is what makes the
   * scale enforceable rather than conventional.
   */
  it.each(['p-5', 'p-7', 'p-9', 'm-10', 'gap-11', 'px-13'])(
    '%s is off the 4px scale and generates nothing',
    (candidate) => {
      expect(generates(candidate)).toBe(false);
    },
  );

  it.each(['p-1', 'p-2', 'p-3', 'p-4', 'p-6', 'p-8', 'p-12', 'p-16'])(
    '%s is on the scale and compiles',
    (candidate) => {
      expect(generates(candidate)).toBe(true);
    },
  );
});

describe('the tokens generate the vocabulary', () => {
  it.each([
    'bg-canvas',
    'bg-surface',
    'text-ink',
    'text-ink-muted',
    'border-border-strong',
    'bg-accent',
    'text-positive',
    'text-caution',
    'text-negative',
    'text-info',
    'text-product-gap',
    'text-xs',
    'text-base',
    'text-3xl',
    'rounded-md',
    'rounded-lg',
    'rounded-pill',
    'shadow-floating',
    'font-sans',
    'font-semibold',
  ])('%s compiles, because the token exists', (candidate) => {
    expect(generates(candidate)).toBe(true);
  });

  /**
   * The semantic colours resolve through the custom properties rather than being frozen at build
   * time, which is what makes a theme swap work without a single `dark:` variant. `inline` on the
   * `@theme` block is why: the utility carries `var(--bg-raised)`, and that property is what the
   * `prefers-color-scheme` block below the tokens redefines.
   */
  it('a colour utility references the token, so both themes come from one class', () => {
    expect(build(['bg-surface'])).toContain('var(--bg-raised)');
  });
});

describe('what the compiler cannot enforce', () => {
  /**
   * Deliberately asserting the uncomfortable thing.
   *
   * If a future Tailwind release ever does let arbitrary values be disabled, this test fails — and
   * failing is the correct outcome, because it means the lint rule in `eslint.config.mjs` can be
   * replaced by something stronger and this comment is out of date.
   */
  it('arbitrary values still compile, which is why the lint rule exists', () => {
    expect(generates('p-[13px]')).toBe(true);
    expect(generates('text-[#b91c1c]')).toBe(true);
  });
});
