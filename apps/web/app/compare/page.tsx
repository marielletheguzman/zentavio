/**
 * The comparison surface — M4's screen (ADR-0026, ADR-0027, ADR-0028).
 *
 * A Server Component rendering a Client Component for the interactive part, the same shape as the
 * gap, résumé and eligibility pages.
 *
 * **The heading does not ask which destination is best**, and neither does anything below it. The
 * comparison groups destinations by what stands in the way and orders nothing within a group; a
 * title asking "where should you go?" would promise an answer the page is built not to give.
 */

import { ComparisonPanel } from './comparison-panel.tsx';

// Read at render on the server. No `process.env` here — configuration is `packages/config`'s job
// (ADR-0005), and these are the values the browser genuinely needs handed to it.
const GATEWAY_URL = 'http://127.0.0.1:8080';
const SEEDED_TEST_USER = '00000000-0000-7000-8000-000000000001';

export default function ComparePage() {
  return (
    <main>
      <a href="#comparison-heading" className="skip-link">
        Skip to the comparison
      </a>

      <h1>What stands between you and each destination</h1>
      <p>
        Every destination is checked against the same two things on the same date: the rules its
        government published, and how ready you are for the work. Nothing here is scored and nothing
        is ranked — where we have not sourced a rule, we say so rather than counting it against the
        destination.
      </p>

      <ComparisonPanel
        gatewayUrl={GATEWAY_URL}
        devUserId={SEEDED_TEST_USER}
        // Computed here rather than in the client component: `new Date()` during a client render is
        // variable input and hydrates differently from the server's HTML.
        today={new Date().toISOString().slice(0, 10)}
      />

      {/* Every page ends in a next action. Both, because the two axes are the two things a person
          can act on and neither is subordinate to the other. */}
      <nav className="next-action">
        <a href="/eligibility">Answer what the rules still need from you</a>
        <a href="/gap">See how far you are from the work itself</a>
      </nav>
    </main>
  );
}
