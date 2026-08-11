/**
 * The applications surface — where outcome recording actually happens (ADR-0019).
 *
 * A Server Component rendering a Client Component for the interactive part, the same shape as the
 * gap and eligibility pages.
 *
 * The development credential is a seeded user id sent as a header (ADR-0017), which the gateway
 * refuses outright in production. When a real session lands it is an httpOnly cookie the browser
 * sends by itself, and this prop disappears.
 */

import { ApplicationsPanel } from './applications-panel.tsx';

// Read at render on the server. No `process.env` here — configuration is `packages/config`'s job
// (ADR-0005), and these are the values the browser genuinely needs handed to it.
const GATEWAY_URL = 'http://127.0.0.1:8080';
const SEEDED_TEST_USER = '00000000-0000-7000-8000-000000000001';

export default function ApplicationsPage() {
  return (
    <main>
      <a href="#applications-heading" className="skip-link">
        Skip to your applications
      </a>

      <h1>What you applied to</h1>
      <p>
        Record what you applied for and what came of it — including applications you made without
        us. We store what we predicted about you at the moment you applied, so that the score can
        later be checked against what actually happened rather than taken on trust.
      </p>

      <ApplicationsPanel gatewayUrl={GATEWAY_URL} devUserId={SEEDED_TEST_USER} />

      {/* Every page ends in a next action. */}
      <nav className="next-action">
        <a href="/gap">See how far you are from the work itself</a>
      </nav>
    </main>
  );
}
