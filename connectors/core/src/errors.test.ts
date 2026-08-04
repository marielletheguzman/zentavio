import { describe, expect, it } from 'vitest';

import { ConnectorError, kindForStatus, parseRetryAfter } from './errors.ts';

describe('kindForStatus', () => {
  it.each([
    [429, 'rate-limited'],
    [500, 'upstream'],
    [502, 'upstream'],
    [503, 'upstream'],
    [504, 'upstream'],
    [400, 'request'],
    [401, 'request'],
    [403, 'request'],
    [422, 'request'],
  ] as const)('classifies %i as %s', (status, kind) => {
    expect(kindForStatus(status)).toBe(kind);
  });
});

describe('ConnectorError.retryable', () => {
  function error(kind: ConstructorParameters<typeof ConnectorError>[1]['kind'], status?: number) {
    return new ConnectorError('nope', { kind, sourceId: 'test-source', status });
  }

  it('retries transport failures and rate limits', () => {
    expect(error('network').retryable).toBe(true);
    expect(error('rate-limited', 429).retryable).toBe(true);
  });

  it.each([502, 503, 504])('retries upstream %i', (status) => {
    expect(error('upstream', status).retryable).toBe(true);
  });

  it('does not retry a 500 — it is not on the retryable list', () => {
    // 502/503/504 mean a proxy or a restart, which passes. A bare 500 is the source's own
    // handler failing, and repeating the same request repeats the same failure.
    expect(error('upstream', 500).retryable).toBe(false);
  });

  it.each([400, 401, 403, 422])('never retries %i — retrying hides the defect', (status) => {
    expect(error('request', status).retryable).toBe(false);
  });

  it('treats a malformed response as terminal', () => {
    // A response we cannot parse usually means the source changed shape. Hammering it will not
    // change that, and the retries delay the alert that says so.
    expect(error('malformed').retryable).toBe(false);
  });

  it('carries the source id, so a failure names which connector produced it', () => {
    expect(error('network').sourceId).toBe('test-source');
  });
});

describe('parseRetryAfter', () => {
  const now = new Date('2026-08-04T12:00:00Z');

  it('reads delta-seconds', () => {
    expect(parseRetryAfter('120', now)).toBe(120_000);
    expect(parseRetryAfter('  30  ', now)).toBe(30_000);
  });

  it('reads an HTTP date', () => {
    expect(parseRetryAfter('Tue, 04 Aug 2026 12:00:30 GMT', now)).toBe(30_000);
  });

  it('clamps a date already in the past to zero rather than a negative delay', () => {
    expect(parseRetryAfter('Tue, 04 Aug 2026 11:59:00 GMT', now)).toBe(0);
  });

  it.each([null, undefined, '', '   ', 'soon', 'not-a-date'])(
    'returns undefined for %p rather than guessing a delay',
    (header) => {
      // A guessed backoff is indistinguishable from a respected one until it turns out to have
      // been too short, by which point the source is blocking us.
      expect(parseRetryAfter(header, now)).toBeUndefined();
    },
  );
});
