/**
 * The gap surface.
 *
 * A Server Component rendering a Client Component for the interactive part, the same shape as the
 * résumé page: nothing here needs client JavaScript except choosing a track and fetching the gap.
 *
 * The development credential is a seeded user id sent as a header (ADR-0017), which the gateway
 * refuses outright in production. When a real session lands it is an httpOnly cookie the browser
 * sends by itself, and this prop disappears.
 */

import { GapPanel } from './gap-panel.tsx';

// Read at render on the server. No `process.env` here — configuration is `packages/config`'s job
// (ADR-0005), and these are the two values the browser genuinely needs handed to it.
const GATEWAY_URL = 'http://127.0.0.1:8080';
const SEEDED_TEST_USER = '00000000-0000-7000-8000-000000000001';

export default function GapPage() {
  return (
    <main>
      <a href="#gap-heading" className="skip-link">
        Skip to your gap
      </a>

      <h1>Your gap</h1>
      <p>
        Pick a track and see what stands between you and it — in the order you would actually close
        it, with what each item is blocked by and how much of it your existing work already covers.
      </p>

      <GapPanel gatewayUrl={GATEWAY_URL} devUserId={SEEDED_TEST_USER} />

      {/* Every page ends in a next action (`.claude/context/ui-guidelines.md`). Closing a gap and
          being allowed to work somewhere are different questions, and this is where the second one
          becomes the obvious thing to ask. */}
      <nav className="next-action">
        <a href="/eligibility">Check whether you could work in Germany</a>
        <a href="/compare">Compare every destination at once</a>
      </nav>
    </main>
  );
}
