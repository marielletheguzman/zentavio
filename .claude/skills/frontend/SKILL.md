---
name: frontend
description: Zentavio's Next.js App Router conventions — Server vs Client Component boundaries, data fetching through the API gateway only, component architecture, state management, loading/empty/error states, accessibility, dark mode, i18n, and how explainability is rendered. Load when editing anything in apps/web, apps/admin, apps/mobile, or packages/ui, adding a page/route/component, or wiring a UI to an API.
---

# Frontend

## Purpose

Zentavio's product claim is that it explains itself. That claim is kept or broken in the
UI: a score without its reasons, a recommendation without its evidence, or a spinner that
never resolves all read as the platform guessing. This skill governs component structure,
state, accessibility, and the rendering contract for explainable output.

## Scope

**Applies to:** `apps/web`, `apps/admin`, `apps/mobile`, `packages/ui`, `packages/i18n`
consumers.

**Does not apply to:** API shape or business rules (`backend-service`), scoring semantics
(`ai-matching`, `career-intelligence`), copy that states domain facts — those come from the
knowledge engine, not from the component.

## Rendering boundary

```text
Server Component (default)          Client Component ('use client')
──────────────────────────          ──────────────────────────────
data fetching                       event handlers
auth/session read                   useState / useEffect / useRef
secrets, server config              browser APIs, focus management
heavy formatting                    animation, drag, charts
```

Push `'use client'` as far down the tree as it will go. A client boundary at the page level
ships the whole page to the browser; a client boundary on the one interactive control ships
the control. Server Components fetch; Client Components react.

## Responsibilities

1. Fetch data only from `services/api-gateway`. The frontend never calls `ai/*`, a
   connector, the database, or a third-party data API directly.
2. Render every one of the four states for any async surface: **loading, empty, error,
   success**. A component with only a success state is unfinished.
3. Render evidence next to every score, match, or recommendation. If the API returns
   `evidence`, the UI shows it or links to it.
4. Keep components presentational; put fetching in a Server Component or a route handler and
   business rules in the backend.
5. Meet WCAG 2.1 AA: semantic elements, labeled controls, visible focus, keyboard paths,
   4.5:1 contrast in both themes, `aria-live` for async results.
6. Route every user-visible string through `packages/i18n`. No hardcoded copy.
7. Support light and dark from the same tokens — no theme-conditional component logic.

## Workflow

1. Read `docs/features/<feature>.md` for the surface being built.
2. Check `packages/ui` for an existing primitive before writing one. Extend, don't fork.
3. Sketch the four states before styling the success state.
4. Decide the server/client split; default to server.
5. Type the response from `packages/types` — never `any`, never a locally redeclared shape.
6. Add i18n keys. Add `aria-*` and roles as you write markup, not afterward.
7. Verify: keyboard-only pass, dark mode pass, 320px-wide pass, and a slow-network pass with
   throttling on.

## State management

| Kind of state | Where it lives |
|---|---|
| Server data | Server Component fetch, or React Query in a client island |
| URL-shaped state (filters, page, tab) | the URL — searchParams |
| Form state | the form (uncontrolled where possible), Server Action to submit |
| Ephemeral UI (open/closed, hover) | local `useState` |
| Cross-page session (user, locale, theme) | context provider at the app root |

Nothing else needs a store. Filters belong in the URL because a career search is a thing
people share and return to.

## Explainability rendering contract

When an API returns a scored object:

```typescript
type Explained<T> = {
  value: T;
  score: number;                 // 0..1
  confidence: 'high' | 'medium' | 'low';
  evidence: Array<{ label: string; detail: string; sourceUrl?: string }>;
  computedAt: string;
};
```

The UI must show the score, the confidence, and a path to the evidence — inline, in a
disclosure, or in a detail view. A bare `87%` with no reachable "why" is a bug, not a
design choice.

## Constraints

- **No direct call to `ai/*`, a connector, or the database from a component.**
- **No secret or private config in a Client Component.** Anything not `NEXT_PUBLIC_` stays
  server-side.
- **No `any` on an API response.** Types come from `packages/types`.
- **No hardcoded user-facing string.** `packages/i18n` only.
- **No `div` with an `onClick` where a `button` belongs.**
- **No layout shift on data arrival** — reserve space with a skeleton matching the final
  shape.
- **No score without evidence rendered or reachable.**
- **No new UI dependency (component library, chart library, animation library) without an
  ADR.**
- **No `useEffect` for data fetching** in a Server Component tree. If it feels necessary,
  the boundary is in the wrong place.

## Examples

**Bad — client boundary at the top, untyped fetch, one state, inaccessible control.**

```tsx
'use client';
export default function MatchesPage() {
  const [data, setData] = useState<any>(null);
  useEffect(() => { fetch('/api/matches').then(r => r.json()).then(setData); }, []);
  return <div>{data?.map((m: any) => (
    <div key={m.id} onClick={() => open(m)}>{m.title} — {m.score * 100}%</div>
  ))}</div>;
}
```

No loading, empty, or error state; `any` twice; a clickable `div`; a score with no evidence;
the whole page shipped to the client.

**Good.**

```tsx
// app/matches/page.tsx — Server Component
import { getMatches } from '@/lib/gateway';
import { MatchCard } from '@/components/match-card';
import { EmptyState } from '@zentavio/ui';

export default async function MatchesPage({ searchParams }: PageProps) {
  const matches = await getMatches(searchParams);          // typed via packages/types
  if (matches.length === 0) return <EmptyState kind="no-matches" />;
  return (
    <ul role="list" className="grid gap-4">
      {matches.map(m => <li key={m.id}><MatchCard match={m} /></li>)}
    </ul>
  );
}
```

`loading.tsx` supplies the skeleton, `error.tsx` the failure state, and `MatchCard` renders
`match.evidence` in a disclosure beside the score.

## Best Practices

- Compose from `packages/ui` primitives; app-level components should be assembly, not CSS.
- Design tokens over literal values — a hex code in a component is a future dark-mode bug.
- Optimistic UI only where the failure is cheap to reverse. Never on money or applications.
- Show confidence honestly: "low confidence" deserves visibly different treatment, not the
  same badge in a paler color.
- Empty states are product surface. "No matches in Germany yet — widen to remote?" beats
  "No results".
- Test the keyboard path for anything a user could plausibly complete without a mouse.
- If a component needs to know a domain fact (a visa rule, a salary band), it should be
  receiving it as data, not encoding it.
