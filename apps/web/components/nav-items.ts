/**
 * What the sidebar may link to.
 *
 * **Every entry here is a route that exists.** `.claude/context/development-instructions.md` puts
 * "never reference a file, API, service, or module that does not exist" first among its rules, and
 * a navigation item is the most user-visible form of that mistake — a link that 404s is a promise
 * the product made and did not keep.
 *
 * The redesign brief asks for an **Account** group holding Profile and Settings. Neither route
 * exists, so neither is here. They are not stubbed either: an empty page under a real URL claims
 * more than a missing one does, and `mvp.md` keeps authentication out of scope until a provider is
 * chosen (ADR-0017 is implemented and unprovisioned). When those routes exist, they go in this
 * file and nowhere else.
 */

export type NavItem = {
  readonly href: string;
  readonly label: string;
  /** The one-line "what is this for", shown in the mobile drawer where there is room for it. */
  readonly summary: string;
  readonly icon: NavIcon;
};

export type NavIcon = 'document' | 'steps' | 'check' | 'passport' | 'compare' | 'sent' | 'speech';

export type NavGroup = {
  readonly label: string;
  readonly items: readonly NavItem[];
};

/**
 * Two groups, and the split is the product's own question order rather than a filing convention:
 * what the platform believes about **you**, then what that means for an **opportunity**.
 */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: 'Your profile',
    items: [
      {
        href: '/',
        label: 'Résumé',
        summary: 'What we read, and the sentence behind each claim',
        icon: 'document',
      },
      {
        href: '/gap',
        label: 'Skill gap',
        summary: 'How far you are from a track, in the order you would close it',
        icon: 'steps',
      },
      {
        href: '/assess',
        label: 'Assessments',
        summary: 'The only thing that moves a skill to evidenced',
        icon: 'check',
      },
    ],
  },
  {
    label: 'Opportunities',
    items: [
      {
        href: '/eligibility',
        label: 'Eligibility',
        summary: 'Germany, rule by rule, with what is still unanswered',
        icon: 'passport',
      },
      {
        href: '/compare',
        label: 'Compare',
        summary: 'Every destination side by side, grouped and never ranked',
        icon: 'compare',
      },
      {
        href: '/applications',
        label: 'Applications',
        summary: 'What you applied to, and what we predicted at the time',
        icon: 'sent',
      },
      {
        href: '/interviews',
        label: 'Interviews',
        summary: 'What we can prepare you for, and what we do not know yet',
        icon: 'speech',
      },
    ],
  },
];

/**
 * The four that reach the bottom bar on a phone.
 *
 * The brief is explicit that not every desktop item belongs there, and these are the four that
 * answer the questions the product exists for. `/assess`, `/applications` and `/interviews` are
 * reachable from the drawer — they are things you do after deciding, not while deciding.
 */
export const PRIMARY_MOBILE_HREFS: readonly string[] = ['/', '/gap', '/eligibility', '/compare'];

/**
 * Active-route matching.
 *
 * `/` is special-cased because every path starts with it, and a prefix match would light up the
 * résumé item on every screen in the app.
 */
export function isActive(href: string, pathname: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}
