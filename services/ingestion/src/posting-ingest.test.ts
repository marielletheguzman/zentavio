import type { ConnectorMeta, ValidationResult } from '@zentavio/connectors-core';
import { describe, expect, it } from 'vitest';

import { expiryLicenceFor, planPostingIngest, summarizePostings, type PostingCandidate } from './posting-ingest.ts';

const EXHAUSTIVE: ConnectorMeta = {
  id: 'lever',
  version: '1.0.0',
  kind: 'job-board',
  regions: [],
  rateLimit: { requests: 60, windowMs: 60_000 },
  reliability: 0,
  termsUrl: 'https://github.com/lever/postings-api',
  displayName: 'Lever (configured employer boards)',
  sourceTier: 2,
  legalBasis: 'Fixture metadata for this file; the real basis lives on the connector.',
  refreshWindow: '1 day',
  schedule: '0 */6 * * *',
  listing: 'exhaustive',
};

const PARTIAL: ConnectorMeta = { ...EXHAUSTIVE, id: 'search-board', listing: 'partial' };
/** A connector that says nothing about its listing. Absence must mean partial. */
const SILENT: ConnectorMeta = { ...EXHAUSTIVE, id: 'quiet-board', listing: undefined };

const OBSERVATION = {
  sourceTier: 2,
  sourceUrl: 'https://api.lever.co/v0/postings/leverdemo?mode=json',
  retrievedAt: new Date('2026-08-22T00:00:00Z'),
  connectorVersion: '1.0.0',
  runId: '01a02a0b-7d56-7000-ac78-ae9ca35746f2',
};

const CLEAN: ValidationResult = { issues: [] };

function candidates(...ids: readonly string[]): PostingCandidate[] {
  return ids.map((externalId) => ({ externalId, fields: { title: `Engineer ${externalId}` } }));
}

function plan(overrides: Partial<Parameters<typeof planPostingIngest>[0]> = {}) {
  return planPostingIngest({
    meta: EXHAUSTIVE,
    sourceScope: 'leverdemo',
    observation: OBSERVATION,
    postings: candidates('a', 'b'),
    validation: CLEAN,
    run: { completed: true },
    ...overrides,
  });
}

describe('what a run stores', () => {
  it('stores each posting under its source identity', () => {
    const decisions = plan().decisions;

    expect(decisions.map((decision) => decision.action)).toEqual(['store', 'store']);
    expect(decisions[0]?.identity).toEqual({ sourceId: 'lever', sourceScope: 'leverdemo', externalId: 'a' });
  });

  it('stores nothing from a batch its own connector rejected', () => {
    // `validate` is the connector's judgement on its own output. Storing a batch it refused would
    // make that judgement decorative.
    const rejected = plan({
      validation: { issues: [{ severity: 'error', code: 'salary-invented', message: 'parsed from prose' }] },
    });

    expect(rejected.decisions.every((decision) => decision.action === 'reject')).toBe(true);
    expect(rejected.decisions[0]?.issues?.[0]?.code).toBe('salary-invented');
  });

  it('ingests a batch carrying only warnings', () => {
    const warned = plan({ validation: { issues: [{ severity: 'warning', code: 'odd-title', message: 'shouty' }] } });

    expect(summarizePostings(warned)).toMatchObject({ store: 2, reject: 0 });
  });

  it('records what the source listed even when it stores none of it', () => {
    // What a source listed and what we were willing to store are different facts.
    const rejected = plan({
      validation: { issues: [{ severity: 'error', code: 'duplicate-external-id', message: 'twice' }] },
    });

    expect(rejected.seenExternalIds).toEqual(['a', 'b']);
  });
});

describe('whether the run may expire anything', () => {
  it('allows a sweep when the source lists exhaustively and the run finished', () => {
    expect(plan().expiry).toEqual({ licensed: true, refusedBecause: null });
    expect(summarizePostings(plan()).willSweep).toBe(true);
  });

  it('refuses a sweep for a source that lists partially, however well the run went', () => {
    expect(plan({ meta: PARTIAL }).expiry).toEqual({
      licensed: false,
      refusedBecause: 'source-lists-partially',
    });
  });

  it('treats an undeclared listing as partial', () => {
    // The safe direction: a connector that says nothing expires nothing. The failure being avoided
    // is retiring a posting somebody is tracking.
    expect(plan({ meta: SILENT }).expiry.licensed).toBe(false);
  });

  it('refuses a sweep when the run did not finish, even from an exhaustive source', () => {
    // A board that dies on its second page returns a short list that looks exactly like a board with
    // fewer jobs. The declaration is not the evidence.
    const short = plan({ run: { completed: false, reason: 'rate limit aborted page 2' } });

    expect(short.expiry).toEqual({ licensed: false, refusedBecause: 'run-did-not-complete' });
    expect(short.decisions.every((decision) => decision.action === 'store')).toBe(true);
  });

  it('refuses a sweep when a complete run listed nothing at all', () => {
    // An employer with nothing open is real, and so is a silently empty response. They are
    // indistinguishable from here, and only one of them is safe to act on.
    expect(plan({ postings: [] }).expiry).toEqual({ licensed: false, refusedBecause: 'nothing-was-listed' });
  });

  it('refuses a sweep for a batch that failed validation', () => {
    // A batch we could not read is not evidence about what is gone.
    const rejected = plan({
      validation: { issues: [{ severity: 'error', code: 'unusable-url', message: 'not linkable' }] },
    });

    expect(rejected.expiry.licensed).toBe(false);
  });

  it('always says why it refused', () => {
    for (const refused of [plan({ meta: PARTIAL }), plan({ run: { completed: false } }), plan({ postings: [] })]) {
      expect(refused.expiry.refusedBecause).not.toBeNull();
    }
  });
});

describe('the licence on its own', () => {
  // Exported because a caller reading a plan should be able to see the reason rather than infer it
  // from a boolean, so it is asserted directly rather than only through a plan.
  it('names the reason for each refusal', () => {
    expect(expiryLicenceFor(PARTIAL, { completed: true }, 5).refusedBecause).toBe('source-lists-partially');
    expect(expiryLicenceFor(EXHAUSTIVE, { completed: false }, 5).refusedBecause).toBe('run-did-not-complete');
    expect(expiryLicenceFor(EXHAUSTIVE, { completed: true }, 0).refusedBecause).toBe('nothing-was-listed');
    expect(expiryLicenceFor(EXHAUSTIVE, { completed: true }, 1)).toEqual({ licensed: true, refusedBecause: null });
  });

  it('checks the source before the run, so a partial source is never blamed on a bad run', () => {
    expect(expiryLicenceFor(PARTIAL, { completed: false }, 0).refusedBecause).toBe('source-lists-partially');
  });
});

describe('purity', () => {
  it('returns the same plan for the same input', () => {
    expect(plan()).toEqual(plan());
  });

  it('names no source of its own', () => {
    // Adding a second job board must not require editing the planner (ADR-0002). The only source id
    // in a plan is the one its own metadata carried in.
    expect(plan({ meta: { ...EXHAUSTIVE, id: 'greenhouse' }, sourceScope: 'acme' }).sourceId).toBe('greenhouse');
  });
});
