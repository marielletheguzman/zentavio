/**
 * The line-icon set, drawn rather than installed.
 *
 * `.claude/context/ui-guidelines.md` asks for one set at one stroke weight and a consistent optical
 * size. No icon package is approved, and pulling one in for seven glyphs is the stack growth
 * ADR-0023 warns arrives one small package at a time — so these are seven paths on a shared 24px
 * grid at stroke 1.75, which reads lighter than the 2 used for status glyphs because navigation is
 * chrome and a status is a claim.
 *
 * Every one is `aria-hidden`. `ui-guidelines.md` forbids an icon-only control without an accessible
 * name, and the answer here is that no control is icon-only — the label is always beside it.
 */

import type { NavIcon } from './nav-items.ts';

export function NavGlyph({ icon }: { icon: NavIcon }) {
  const shared = {
    'aria-hidden': true as const,
    className: 'size-4 shrink-0',
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    viewBox: '0 0 24 24',
    xmlns: 'http://www.w3.org/2000/svg',
  };

  switch (icon) {
    case 'document':
      return (
        <svg {...shared}>
          <path d="M6 3h8l4 4v14H6z" />
          <path d="M14 3v4h4M9 12h6M9 16h6" />
        </svg>
      );
    case 'steps':
      // Ascending, because the gap is ordered and the order is the meaning.
      return (
        <svg {...shared}>
          <path d="M4 19h5v-5H4zM10 19h5v-9h-5zM16 19h5V5h-5z" />
        </svg>
      );
    case 'check':
      return (
        <svg {...shared}>
          <path d="M9 12.5 11.5 15 16 9.5" />
          <circle cx="12" cy="12" r="8.5" />
        </svg>
      );
    case 'passport':
      return (
        <svg {...shared}>
          <path d="M6 3h12v18H6z" />
          <circle cx="12" cy="10" r="3" />
          <path d="M9 16h6" />
        </svg>
      );
    case 'compare':
      // Two columns of equal height. Nothing on the comparison is ranked, including its icon.
      return (
        <svg {...shared}>
          <path d="M6 5v14M18 5v14M6 9h12M6 15h12" />
        </svg>
      );
    case 'sent':
      return (
        <svg {...shared}>
          <path d="M4 12 20 5l-3 15-5-5-4 3z" />
          <path d="M12 15l8-10" />
        </svg>
      );
    case 'speech':
      return (
        <svg {...shared}>
          <path d="M5 6h14v10H9l-4 3z" />
          <path d="M9 10h6" />
        </svg>
      );
  }
}
