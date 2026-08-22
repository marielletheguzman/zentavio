'use client';

/**
 * Reading a company's process, and contributing to it (ADR-0031, ADR-0032).
 *
 * ## Two things this component is careful about
 *
 * **The shortfall is the main path, and it is written as one.** It says the count and what is
 * missing — *"2 reports, 3 more before we can describe this"* — because that invites a contribution
 * and *"not enough"* is a dead end. Almost every pairing will look like this for a long time.
 *
 * **The withdrawal disclosure is on the form, before submitting.** ADR-0032 part 4 requires it
 * there: withdrawing a report removes the name and keeps the count, and a consequence explained
 * after the fact is not a disclosure. It is repeated on the withdraw button, which is where somebody
 * finds out whether we meant it.
 *
 * No pattern is ever rendered without its `n`. A stage on its own is a claim about a company.
 */

import { useCallback, useEffect, useId, useState } from 'react';

const STAGE_KINDS = [
  'recruiter-screen',
  'technical-screen',
  'coding',
  'system-design',
  'take-home',
  'behavioural',
  'hiring-manager',
  'panel',
  'final',
] as const;

type StageKind = (typeof STAGE_KINDS)[number];

interface Company {
  readonly id: string;
  readonly name: string;
}

interface StagePattern {
  readonly kind: StageKind;
  readonly reportCount: number;
  readonly typicalPosition: number;
}

type Support =
  | {
      readonly kind: 'described';
      readonly reportCount: number;
      readonly windowMonths: number;
      readonly stages: readonly StagePattern[];
      readonly confidence: 'low' | 'medium';
    }
  | {
      readonly kind: 'below-support';
      readonly reportCount: number;
      readonly needed: number;
      readonly windowMonths: number;
    };

interface Theme {
  readonly skillId: string;
  readonly name: string;
  readonly weight: number;
  readonly cluster: string;
  readonly standing: 'evidenced' | 'claimed' | 'missing';
}

interface Preparation {
  readonly careerId: string | null;
  readonly themes: readonly Theme[];
  readonly requirementCount: number;
}

interface MyReport {
  readonly id: string;
  readonly company_id: string;
  readonly role_family: string;
  readonly interviewed_on: string;
}

const ROLE_FAMILIES = ['software-it', 'healthcare', 'other'] as const;

export function InterviewPanel({
  gatewayUrl,
  devUserId,
}: {
  gatewayUrl: string;
  devUserId: string;
}) {
  const [companies, setCompanies] = useState<readonly Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [roleFamily, setRoleFamily] = useState<string>(ROLE_FAMILIES[0]);
  const [support, setSupport] = useState<Support | null>(null);
  const [mine, setMine] = useState<readonly MyReport[]>([]);
  const [preparation, setPreparation] = useState<Preparation | null>(null);
  const [stages, setStages] = useState<readonly StageKind[]>([]);
  const [interviewedOn, setInterviewedOn] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const headingId = useId();

  const headers = useCallback(
    () => ({ 'content-type': 'application/json', 'x-zentavio-dev-user': devUserId }),
    [devUserId],
  );

  const loadMine = useCallback(async () => {
    const response = await fetch(`${gatewayUrl}/v1/interview-reports`, { headers: headers() });
    if (!response.ok) return;
    const body = (await response.json()) as { reports: readonly MyReport[] };
    setMine(body.reports);
  }, [gatewayUrl, headers]);

  useEffect(() => {
    void (async () => {
      const response = await fetch(`${gatewayUrl}/v1/companies`, { headers: headers() });
      if (!response.ok) return;
      const body = (await response.json()) as { companies: readonly Company[] };
      setCompanies(body.companies);
      setCompanyId((current) => current || (body.companies[0]?.id ?? ''));
      await loadMine();

      // Fetched once and shown regardless of the pairing: it is about the role, not the company,
      // and it is what almost everybody will actually read.
      const prep = await fetch(`${gatewayUrl}/v1/role-preparation`, { headers: headers() });
      if (prep.ok) setPreparation((await prep.json()) as Preparation);
    })();
  }, [gatewayUrl, headers, loadMine]);

  const loadSupport = useCallback(async () => {
    if (companyId === '') return;
    const asOf = new Date().toISOString().slice(0, 10);
    const response = await fetch(
      `${gatewayUrl}/v1/interview-process?company=${companyId}&roleFamily=${encodeURIComponent(roleFamily)}&asOf=${asOf}`,
      { headers: headers() },
    );
    if (!response.ok) return;
    setSupport((await response.json()) as Support);
  }, [companyId, gatewayUrl, headers, roleFamily]);

  useEffect(() => {
    void loadSupport();
  }, [loadSupport]);

  const existing = mine.find(
    (report) => report.company_id === companyId && report.role_family === roleFamily,
  );

  async function contribute() {
    const response = await fetch(`${gatewayUrl}/v1/interview-reports`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        companyId,
        roleFamily,
        interviewedOn: new Date(interviewedOn).toISOString(),
        stages: stages.map((kind, index) => ({ position: index + 1, kind })),
      }),
    });

    setNote(
      response.ok
        ? 'Recorded. Your report counts toward this company’s process and is never shown with your name.'
        : 'That did not save.',
    );
    setStages([]);
    await loadMine();
    await loadSupport();
  }

  async function withdraw(reportId: string) {
    const response = await fetch(`${gatewayUrl}/v1/interview-reports/${reportId}/withdrawal`, {
      method: 'POST',
      headers: headers(),
    });

    const body = response.ok ? ((await response.json()) as { note: string }) : null;
    setNote(body?.note ?? 'That did not work.');
    await loadMine();
    await loadSupport();
  }

  return (
    <section aria-labelledby={headingId} id="interviews-heading">
      <h2 id={headingId}>Choose a company and a kind of role</h2>

      <div className="card">
        <label htmlFor="company">Company</label>
        <select
          id="company"
          value={companyId}
          onChange={(event) => {
            setCompanyId(event.target.value);
          }}
        >
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </select>

        <label htmlFor="role-family">Kind of role</label>
        {/* The unit of support. A company's sales process says nothing about its backend process,
            so the pairing is chosen rather than assumed (ADR-0031). */}
        <select
          id="role-family"
          value={roleFamily}
          onChange={(event) => {
            setRoleFamily(event.target.value);
          }}
        >
          {ROLE_FAMILIES.map((family) => (
            <option key={family} value={family}>
              {family}
            </option>
          ))}
        </select>
      </div>

      {note === null ? null : <p role="status">{note}</p>}

      {support === null ? null : support.kind === 'below-support' ? (
        <div className="card">
          <h3>We can&rsquo;t describe this process yet</h3>
          <p>
            {support.reportCount === 0
              ? 'Nobody has reported this one to us.'
              : `${support.reportCount} report${support.reportCount === 1 ? '' : 's'} so far.`}{' '}
            <strong>
              {support.needed} more before we describe it
            </strong>
            , counted over the last {support.windowMonths} months.
          </p>
          <p className="hint">
            We could guess from what we have. We don&rsquo;t, because a stage two people mentioned is
            not a company&rsquo;s process, and preparing for the wrong thing costs you a week you
            can&rsquo;t get back.
          </p>
        </div>
      ) : (
        <div className="card">
          <h3>What people report</h3>
          <p className="hint">
            From {support.reportCount} reports over the last {support.windowMonths} months.
            Confidence: {support.confidence} — this is experience people shared, never company
            policy, and it never rises above medium however many agree.
          </p>
          <ol>
            {support.stages.map((stage) => (
              <li key={stage.kind}>
                {stage.kind}{' '}
                {/* Never rendered without its n. A stage on its own is a claim about a company. */}
                <span className="hint">
                  — {stage.reportCount} of {support.reportCount} reports, usually stage{' '}
                  {stage.typicalPosition}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {preparation === null || preparation.themes.length === 0 ? null : (
        <div className="card">
          <h3>What to prepare anyway</h3>
          <p className="hint">
            From what your target role requires — not from this company. It says the same thing
            whether five people reported them or nobody has. Showing{' '}
            {preparation.themes.length} of {preparation.requirementCount} requirements, heaviest
            first.
          </p>
          <ul>
            {preparation.themes.map((theme) => (
              <li key={theme.skillId}>
                {theme.name}{' '}
                <span className="hint">
                  — {theme.cluster}, weight {theme.weight.toFixed(2)}
                  {theme.standing === 'evidenced'
                    ? ' · you already evidence this'
                    : theme.standing === 'claimed'
                      ? ' · claimed on your profile, not yet evidenced'
                      : ' · not on your profile'}
                </span>
              </li>
            ))}
          </ul>
          {/* No questions. Generated questions belong to `ai/interview-prep`, which does not exist,
              and a question invented here beside a company's name is the fabrication this milestone
              is written against. */}
          <p className="hint">
            These are themes, not questions. We don&rsquo;t generate questions yet, and we
            won&rsquo;t attribute one to a company we haven&rsquo;t heard from.
          </p>
        </div>
      )}

      <div className="card">
        <h3>{existing === undefined ? 'Add your report' : 'You already reported this one'}</h3>

        {existing === undefined ? (
          <>
            <label htmlFor="interviewed-on">When did you interview?</label>
            <input
              id="interviewed-on"
              type="date"
              value={interviewedOn}
              onChange={(event) => {
                setInterviewedOn(event.target.value);
              }}
            />

            <fieldset>
              <legend>Which stages did you go through, in order?</legend>
              {STAGE_KINDS.map((kind) => (
                <label key={kind} htmlFor={`stage-${kind}`}>
                  <input
                    id={`stage-${kind}`}
                    type="checkbox"
                    checked={stages.includes(kind)}
                    onChange={() => {
                      setStages((current) =>
                        current.includes(kind)
                          ? current.filter((existingKind) => existingKind !== kind)
                          : [...current, kind],
                      );
                    }}
                  />
                  {kind}
                </label>
              ))}
            </fieldset>

            {/* **Before submitting, not after.** ADR-0032 part 4: withdrawal removes the name and
                keeps the count, and somebody consenting to contribute is entitled to know what they
                cannot take back. */}
            <p className="hint">
              Before you add this: your report is never shown with your name. If you withdraw it
              later, <strong>your name comes off and the report still counts</strong> toward what
              this company&rsquo;s process looks like — otherwise one person leaving could change
              what everybody else is told.
            </p>

            <button
              type="button"
              disabled={stages.length === 0 || interviewedOn === ''}
              onClick={() => void contribute()}
            >
              Add my report
            </button>
          </>
        ) : (
          <>
            <p>
              You reported this on {existing.interviewed_on.slice(0, 10)}. You can withdraw it.
            </p>
            <button type="button" onClick={() => void withdraw(existing.id)}>
              Withdraw my report — name off, report still counts
            </button>
          </>
        )}
      </div>
    </section>
  );
}
