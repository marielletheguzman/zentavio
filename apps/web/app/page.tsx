/**
 * The résumé surface.
 *
 * A Server Component that renders a Client Component for the interactive part — the default in the
 * App Router, and the right one here: nothing on this page needs client JavaScript except the
 * upload itself.
 *
 * `userId` is passed explicitly because **authentication is deliberately out of M1a** (decided
 * 2026-08-01). It comes from a seeded test user, which is exactly why this page is demoable and not
 * deployable: when auth lands, the subject comes from a session and this prop disappears.
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

      <UploadPanel gatewayUrl={GATEWAY_URL} userId={SEEDED_TEST_USER} />
    </main>
  );
}
