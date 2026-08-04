/**
 * The résumé surface.
 *
 * A Server Component that renders a Client Component for the interactive part — the default in the
 * App Router, and the right one here: nothing on this page needs client JavaScript except the
 * upload itself.
 *
 * The subject now comes from a credential the caller cannot choose (ADR-0017), not from the request
 * body. What remains is a **development** credential: a seeded user id sent as a header, which the
 * gateway refuses outright in production. When a real session lands it is an httpOnly cookie the
 * browser sends by itself, and this prop disappears entirely.
 */

import { UploadPanel } from './resume/upload-panel.tsx';

// Read at render on the server. No `process.env` here — configuration is `packages/config`'s job
// (ADR-0005), and these are the two values the browser genuinely needs handed to it.
const GATEWAY_URL = 'http://127.0.0.1:8080';
const SEEDED_TEST_USER = '00000000-0000-7000-8000-000000000001';

export default function Home() {
  return (
    <main>
      <a href="#upload-heading" className="skip-link">
        Skip to upload
      </a>

      <h1>Zentavio</h1>
      <p>
        Upload a résumé and see what the platform believes about you — with the sentence behind every
        claim, and an honest answer where it does not know.
      </p>

      <UploadPanel gatewayUrl={GATEWAY_URL} devUserId={SEEDED_TEST_USER} />

      {/* Every page ends in a next action. Both of them, because after a résumé the honest answer
          is that there are two questions and neither is subordinate to the other. */}
      <nav className="next-action">
        <a href="/gap">See how far you are from a track</a>
        <a href="/eligibility">Check whether you could work in Germany</a>
      </nav>
    </main>
  );
}
