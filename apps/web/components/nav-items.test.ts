/**
 * The navigation's two invariants, both of which fail silently in a screenshot.
 *
 * **Every link points at a route that exists.** A 404 in the sidebar is the most visible form of
 * the mistake `.claude/context/development-instructions.md` puts first — referencing something that
 * does not exist — and it is invisible until someone clicks. This walks `app/` and compares.
 *
 * **`/` does not match every path.** Prefix matching is the obvious implementation and it lights up
 * the résumé item on every screen in the product, which makes the active state meaningless
 * everywhere rather than wrong in one place.
 */

import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { NAV_GROUPS, PRIMARY_MOBILE_HREFS, isActive } from './nav-items.ts';

const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));

/**
 * The routes the App Router actually serves: a directory under `app/` holding a `page.tsx`.
 *
 * Route groups and private folders are excluded by the same rule Next uses — a leading `(` or `_`
 * means the segment is not part of the URL.
 */
function routesOnDisk(): Set<string> {
  const routes = new Set<string>(['/']);

  for (const entry of readdirSync(APP_DIR)) {
    const path = join(APP_DIR, entry);
    if (!statSync(path).isDirectory()) continue;
    if (entry.startsWith('(') || entry.startsWith('_')) continue;
    if (readdirSync(path).includes('page.tsx')) routes.add(`/${entry}`);
  }

  return routes;
}

const items = NAV_GROUPS.flatMap((group) => group.items);

describe('every navigation item points at a route that exists', () => {
  const routes = routesOnDisk();

  it.each(items.map((item) => item.href))('%s is served by app/', (href) => {
    expect(routes).toContain(href);
  });

  it('the bottom bar is a subset of the sidebar, not a second list', () => {
    const hrefs = new Set(items.map((item) => item.href));
    for (const href of PRIMARY_MOBILE_HREFS) expect(hrefs).toContain(href);
  });

  /**
   * The brief asks for an Account group holding Profile and Settings. Neither route exists, so
   * neither is listed — and this asserts the absence rather than trusting it, because "add the
   * missing nav items" is exactly the kind of tidy-up that gets done without checking.
   */
  it('does not link to routes the product has not built', () => {
    const hrefs = items.map((item) => item.href);
    expect(hrefs).not.toContain('/profile');
    expect(hrefs).not.toContain('/settings');
  });

  it('every item carries a label and a summary, because the drawer shows both', () => {
    for (const item of items) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.summary.length).toBeGreaterThan(0);
    }
  });
});

describe('isActive', () => {
  it('matches the résumé surface only at the root', () => {
    expect(isActive('/', '/')).toBe(true);
    expect(isActive('/', '/gap')).toBe(false);
    expect(isActive('/', '/eligibility')).toBe(false);
  });

  it('matches a section and its children', () => {
    expect(isActive('/gap', '/gap')).toBe(true);
    expect(isActive('/gap', '/gap/cloud-platform-engineer')).toBe(true);
  });

  /** `/assess` must not light up on `/assessments`, which is a different word. */
  it('does not match a route that merely starts with the same characters', () => {
    expect(isActive('/assess', '/assessments')).toBe(false);
    expect(isActive('/compare', '/comparex')).toBe(false);
  });

  it('marks exactly one item active on each route', () => {
    for (const route of routesOnDisk()) {
      const active = items.filter((item) => isActive(item.href, route));
      expect(active, `route ${route}`).toHaveLength(1);
    }
  });
});
