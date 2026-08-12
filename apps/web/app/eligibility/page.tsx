/**
 * The eligibility surface.
 *
 * A Server Component rendering a Client Component for the interactive part, the same shape as the
 * gap and résumé pages.
 *
 * The development credential is a seeded user id sent as a header (ADR-0017), which the gateway
 * refuses outright in production. When a real session lands it is an httpOnly cookie the browser
 * sends by itself, and this prop disappears.
 */

import { EligibilityPanel } from './eligibility-panel.tsx';

// Read at render on the server. No `process.env` here — configuration is `packages/config`'s job
// (ADR-0005), and these are the values the browser genuinely needs handed to it.
const GATEWAY_URL = 'http://127.0.0.1:8080';
const SEEDED_TEST_USER = '00000000-0000-7000-8000-000000000001';
const PATHWAY = 'de.eu-blue-card';

export default function EligibilityPage() {
  return (
    <main>
      <a href="#eligibility-heading" className="skip-link">
        Skip to your result
      </a>

      <h1>Can you move to Germany on a Blue Card?</h1>
      <p>
        Checked against the rules the German government published, on the date you choose — with the
        source for every one of them. Where we cannot answer, we say what is missing rather than
        guessing.
      </p>

      <EligibilityPanel
        gatewayUrl={GATEWAY_URL}
        devUserId={SEEDED_TEST_USER}
        pathway={PATHWAY}
        // Computed here rather than in the client component: `new Date()` during a client render
        // is variable input and hydrates differently from the server's HTML.
        today={new Date().toISOString().slice(0, 10)}
      />

      {/* Every page ends in a next action. When readiness is what binds, the gap is where you go. */}
      <nav className="next-action">
        <a href="/gap">See how far you are from the work itself</a>
        <a href="/compare">See this beside every other destination</a>
      </nav>
    </main>
  );
}
