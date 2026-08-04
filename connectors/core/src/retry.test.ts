import { describe, expect, it, vi } from 'vitest';

import { ConnectorError } from './errors.ts';
import { DEFAULT_RETRY_POLICY, backoffMs, withRetry, type RetryDeps, type RetryPolicy } from './retry.ts';

/**
 * Deterministic deps. `sleep` records rather than waits, so the suite asserts the delays the
 * policy *chose* — a test that actually slept would be slow and would still not prove the
 * number was right.
 */
function testDeps(overrides: Partial<RetryDeps> = {}): RetryDeps & { slept: number[] } {
  const slept: number[] = [];
  let clock = 0;
  return {
    slept,
    sleep: async (ms) => {
      slept.push(ms);
      clock += ms;
    },
    random: () => 1,
    now: () => clock,
    ...overrides,
  };
}

function connectorError(kind: ConstructorParameters<typeof ConnectorError>[1]['kind'], status?: number) {
  return new ConnectorError('upstream said no', { kind, sourceId: 'test-source', status });
}

describe('backoffMs', () => {
  it('doubles per attempt and caps at maxDelayMs', () => {
    const policy: RetryPolicy = { maxAttempts: 9, baseDelayMs: 100, maxDelayMs: 800, maxTotalMs: 60_000 };
    const full = () => 1;

    expect(backoffMs(1, policy, full)).toBe(100);
    expect(backoffMs(2, policy, full)).toBe(200);
    expect(backoffMs(3, policy, full)).toBe(400);
    expect(backoffMs(4, policy, full)).toBe(800);
    expect(backoffMs(5, policy, full)).toBe(800);
  });

  it('draws from the whole interval, not a band around it — full jitter', () => {
    const policy: RetryPolicy = { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 30_000, maxTotalMs: 60_000 };

    // The de-correlation property is that a delay near zero is reachable. `backoff ± noise`
    // could not produce this, and a synchronised retry storm is what that costs.
    expect(backoffMs(3, policy, () => 0)).toBe(0);
    expect(backoffMs(3, policy, () => 0.5)).toBe(2000);
    expect(backoffMs(3, policy, () => 1)).toBe(4000);
  });

  it("honours the source's Retry-After when it is longer than our backoff", () => {
    const policy: RetryPolicy = { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1000, maxTotalMs: 60_000 };

    expect(backoffMs(1, policy, () => 1, 5000)).toBe(5000);
    // ...and does not shorten a wait we would have taken anyway.
    expect(backoffMs(1, policy, () => 1, 10)).toBe(100);
  });
});

describe('withRetry', () => {
  it('returns the first success without sleeping', async () => {
    const deps = testDeps();
    const operation = vi.fn(async () => 'ok');

    await expect(withRetry(operation, DEFAULT_RETRY_POLICY, deps)).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(1);
    expect(deps.slept).toEqual([]);
  });

  it('retries a retryable failure and succeeds', async () => {
    const deps = testDeps();
    let calls = 0;
    const operation = async () => {
      calls += 1;
      if (calls < 3) throw connectorError('upstream', 503);
      return 'ok';
    };

    await expect(withRetry(operation, DEFAULT_RETRY_POLICY, deps)).resolves.toBe('ok');
    expect(calls).toBe(3);
    expect(deps.slept).toHaveLength(2);
  });

  it.each([
    ['request', 400],
    ['request', 401],
    ['request', 403],
    ['request', 422],
  ] as const)('never retries a %s failure (%i) — retrying would hide the defect', async (kind, status) => {
    const deps = testDeps();
    const operation = vi.fn(async () => {
      throw connectorError(kind, status);
    });

    await expect(withRetry(operation, DEFAULT_RETRY_POLICY, deps)).rejects.toThrow(ConnectorError);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(deps.slept).toEqual([]);
  });

  it('rethrows a non-ConnectorError immediately — a bug is not a hiccup', async () => {
    const deps = testDeps();
    const operation = vi.fn(async () => {
      throw new TypeError('cannot read property of undefined');
    });

    await expect(withRetry(operation, DEFAULT_RETRY_POLICY, deps)).rejects.toThrow(TypeError);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxAttempts and throws the last failure', async () => {
    const deps = testDeps();
    const policy: RetryPolicy = { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100, maxTotalMs: 60_000 };
    const operation = vi.fn(async () => {
      throw connectorError('network');
    });

    await expect(withRetry(operation, policy, deps)).rejects.toThrow(ConnectorError);
    expect(operation).toHaveBeenCalledTimes(3);
    expect(deps.slept).toHaveLength(2);
  });

  it('stops before sleeping past maxTotalMs rather than after', async () => {
    // The budget is checked against the delay about to be incurred. Sleeping first and then
    // discovering the deadline passed wastes the entire delay for no attempt.
    const deps = testDeps();
    const policy: RetryPolicy = { maxAttempts: 5, baseDelayMs: 1000, maxDelayMs: 10_000, maxTotalMs: 1500 };
    const operation = vi.fn(async () => {
      throw connectorError('upstream', 503);
    });

    await expect(withRetry(operation, policy, deps)).rejects.toThrow(ConnectorError);
    expect(operation).toHaveBeenCalledTimes(2);
    expect(deps.slept).toEqual([1000]);
  });

  it('reports each retry to the caller for logging', async () => {
    const deps = testDeps();
    const policy: RetryPolicy = { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100, maxTotalMs: 60_000 };
    const seen: number[] = [];
    const operation = async () => {
      throw connectorError('network');
    };

    await expect(
      withRetry(operation, policy, deps, (_error, attempt) => seen.push(attempt)),
    ).rejects.toThrow(ConnectorError);
    expect(seen).toEqual([1, 2]);
  });
});
