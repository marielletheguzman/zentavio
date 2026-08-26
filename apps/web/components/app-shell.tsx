'use client';

/**
 * The application shell: sidebar on a desktop, drawer plus bottom bar on a phone.
 *
 * A Client Component, and only because of `usePathname` — the active route has to be known to
 * render, and there is no server equivalent that survives client-side navigation. Everything the
 * shell wraps stays whatever it already was; this is a layout, not a boundary that forces its
 * children to be interactive.
 *
 * ## Three things the navigation must not do
 *
 * **It must not link anywhere that does not exist.** The list is `nav-items.ts` and the brief's
 * Account group is deliberately absent from it — see that file.
 *
 * **The active item must not be marked by colour alone.** It takes a filled background, a left
 * accent bar, a weight change, *and* `aria-current="page"`. The last one is the only signal a
 * screen-reader user gets, and it is the one that is easiest to forget because nothing looks wrong
 * without it.
 *
 * **The drawer must return focus.** Opening it moves focus in; closing it — by button, by Escape,
 * or by following a link — puts focus back on the toggle, or the keyboard user is left at the top
 * of the document with no idea where they are.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';

import { cx } from './cx.ts';
import { NavGlyph } from './nav-icon.tsx';
import { NAV_GROUPS, PRIMARY_MOBILE_HREFS, isActive, type NavItem } from './nav-items.ts';

function NavLink({
  item,
  active,
  onNavigate,
  showSummary = false,
}: {
  item: NavItem;
  active: boolean;
  /*
   * `| undefined` written out, not implied by `?`. `exactOptionalPropertyTypes` in
   * `tsconfig.base.json` makes "absent" and "present and undefined" different types, and these
   * props are forwarded from a caller that has one of them and not the other.
   */
  onNavigate?: (() => void) | undefined;
  showSummary?: boolean | undefined;
}) {
  return (
    <Link
      href={item.href}
      /*
       * Spread rather than `onClick={onNavigate}`: `exactOptionalPropertyTypes` is on in
       * `tsconfig.base.json`, so an explicit `undefined` is not the same as an absent prop and
       * `LinkProps` refuses it. The handler only exists in the drawer, where following a link has
       * to close it.
       */
      {...(onNavigate !== undefined ? { onClick: onNavigate } : {})}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'flex min-h-12 items-center gap-3 rounded-md border-l-4 px-3 py-2 no-underline',
        'transition-colors duration-150',
        active
          ? 'border-l-accent bg-surface font-semibold text-ink'
          : 'border-l-transparent font-medium text-ink-muted hover:bg-surface hover:text-ink',
      )}
    >
      <NavGlyph icon={item.icon} />
      <span className="min-w-0">
        <span className="block">{item.label}</span>
        {showSummary && (
          <span className="block text-sm font-normal text-ink-muted">{item.summary}</span>
        )}
      </span>
    </Link>
  );
}

function NavTree({
  pathname,
  onNavigate,
  showSummary,
}: {
  pathname: string;
  onNavigate?: (() => void) | undefined;
  showSummary?: boolean | undefined;
}) {
  return (
    <div className="flex flex-col gap-6">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <h2 className="px-3 text-sm font-medium tracking-wide text-ink-muted uppercase">
            {group.label}
          </h2>
          <ul className="mt-2 flex list-none flex-col gap-1 p-0">
            {group.items.map((item) => (
              <li key={item.href}>
                <NavLink
                  item={item}
                  active={isActive(item.href, pathname)}
                  onNavigate={onNavigate}
                  showSummary={showSummary}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Wordmark() {
  return (
    <Link
      href="/"
      className="flex min-h-12 items-center gap-2 px-3 text-lg font-semibold text-ink no-underline"
    >
      {/*
       * Two marks of unequal height: the product is about a distance between where you are and
       * where you want to be. Decorative, so it is hidden from assistive technology — the wordmark
       * beside it is the accessible name.
       */}
      <svg
        aria-hidden="true"
        className="size-4 shrink-0 text-accent"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M5 19V11M12 19V7M19 19V3" />
      </svg>
      Zentavio
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    toggleRef.current?.focus();
  }, []);

  // Escape closes it. A drawer that traps a keyboard user with no way out is worse than no drawer.
  useEffect(() => {
    if (!drawerOpen) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeDrawer();
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen, closeDrawer]);

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <a
        href="#main"
        className={cx(
          'sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-20',
          'focus:rounded-md focus:border focus:border-border-strong focus:bg-surface focus:px-3 focus:py-2',
        )}
      >
        Skip to content
      </a>

      {/* ── desktop sidebar ───────────────────────────────────────────────── */}
      <div className="lg:flex">
        <nav
          aria-label="Sections"
          className="hidden w-64 shrink-0 border-r border-border p-4 lg:sticky lg:top-0 lg:block lg:h-screen lg:overflow-y-auto"
        >
          <Wordmark />
          <div className="mt-8">
            <NavTree pathname={pathname} />
          </div>
        </nav>

        <div className="min-w-0 flex-1">
          {/* ── mobile top bar ──────────────────────────────────────────── */}
          <div className="flex items-center justify-between border-b border-border px-4 py-2 lg:hidden">
            <Wordmark />
            <button
              type="button"
              ref={toggleRef}
              onClick={() => setDrawerOpen((open) => !open)}
              aria-expanded={drawerOpen}
              aria-controls="nav-drawer"
              className="inline-flex min-h-12 items-center gap-2 rounded-md border border-border-strong px-4 text-base font-medium text-ink"
            >
              <svg
                aria-hidden="true"
                className="size-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                xmlns="http://www.w3.org/2000/svg"
              >
                {drawerOpen ? <path d="M6 6 18 18M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
              </svg>
              Menu
            </button>
          </div>

          {drawerOpen && (
            <nav
              id="nav-drawer"
              aria-label="Sections"
              className="border-b border-border p-4 lg:hidden"
            >
              <NavTree pathname={pathname} onNavigate={closeDrawer} showSummary />
            </nav>
          )}

          {/*
           * `pb-24` on small screens keeps the last card clear of the bottom bar. Without it the
           * final action on every page sits underneath a fixed element — which looks fine in a
           * screenshot taken at the top of the page.
           */}
          <main id="main" className="mx-auto w-full max-w-xl px-4 pt-6 pb-24 lg:px-8 lg:pb-16">
            {children}
          </main>
        </div>
      </div>

      {/* ── mobile bottom bar ─────────────────────────────────────────────── */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-canvas lg:hidden"
      >
        <ul className="m-0 flex list-none justify-around p-0">
          {NAV_GROUPS.flatMap((group) => group.items)
            .filter((item) => PRIMARY_MOBILE_HREFS.includes(item.href))
            .map((item) => {
              const active = isActive(item.href, pathname);
              return (
                <li key={item.href} className="flex-1">
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cx(
                      'flex min-h-12 flex-col items-center justify-center gap-1 px-2 py-2 text-sm no-underline',
                      active ? 'font-semibold text-accent' : 'font-medium text-ink-muted',
                    )}
                  >
                    <NavGlyph icon={item.icon} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
        </ul>
      </nav>
    </div>
  );
}
