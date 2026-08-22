/**
 * The interview surface (M8).
 *
 * **The below-threshold path is the product here, not the fallback.** Five reports per company and
 * role family in eighteen months is demanding, so almost every pairing will show a shortfall for a
 * long time (ADR-0031's accepted costs). The shortfall is therefore written to be useful — it says
 * how many reports exist and how many are missing — rather than written as an apology.
 *
 * A Server Component rendering a Client Component, the same shape as the other pages here.
 */

import { InterviewPanel } from './interview-panel.tsx';

// Read at render on the server. No `process.env` here — configuration is `packages/config`'s job
// (ADR-0005), and these are the values the browser genuinely needs handed to it.
const GATEWAY_URL = 'http://127.0.0.1:8080';
const SEEDED_TEST_USER = '00000000-0000-7000-8000-000000000001';

export default function InterviewsPage() {
  return (
    <main>
      <a href="#interviews-heading" className="skip-link">
        Skip to the process
      </a>

      <h1>What their interview process looks like</h1>
      <p>
        Built from what people who interviewed there told us — never from a company&rsquo;s own
        description, and never from one person&rsquo;s account. Every pattern shows how many reports
        it came from and over what period, because a process without its count is a rumour with a
        confident voice.
      </p>

      <InterviewPanel gatewayUrl={GATEWAY_URL} devUserId={SEEDED_TEST_USER} />
    </main>
  );
}
