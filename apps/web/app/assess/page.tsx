/**
 * The assessment surface — the only place a skill can be promoted to `evidenced` (ADR-0030).
 *
 * A Server Component rendering a Client Component for the interactive part, the same shape as the
 * gap, eligibility and applications pages.
 *
 * **The limit is stated before anybody starts, not only after they pass.** A boundary shown only in
 * the small print of a success is a boundary nobody reads, and this page's whole reason for
 * existing is that a person can tell what our "evidenced" does and does not mean about them.
 */

import { AssessmentPanel } from './assessment-panel.tsx';

// Read at render on the server. No `process.env` here — configuration is `packages/config`'s job
// (ADR-0005), and these are the values the browser genuinely needs handed to it.
const GATEWAY_URL = 'http://127.0.0.1:8080';
const SEEDED_TEST_USER = '00000000-0000-7000-8000-000000000001';

/** The seeded track's Git skill. One instrument exists; the panel asks the gateway which. */
const SKILL_ID_PARAM = 'git';

export default function AssessPage() {
  return (
    <main>
      <a href="#assessment-heading" className="skip-link">
        Skip to the assessment
      </a>

      <h1>Show what you can do</h1>
      <p>
        Completing a course does not move your readiness — anyone can finish a video. Passing an
        assessment does, and only for the skill it actually covers. Every question says where its
        answer comes from, and every result says what passing it does <strong>not</strong> show.
      </p>

      <AssessmentPanel
        gatewayUrl={GATEWAY_URL}
        devUserId={SEEDED_TEST_USER}
        skillSlug={SKILL_ID_PARAM}
      />
    </main>
  );
}
