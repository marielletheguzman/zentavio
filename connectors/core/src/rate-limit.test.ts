import { describe, expect, it } from 'vitest';

import { RateLimiter, type LimiterDeps } from './rate-limit.ts';

/**
 * A controllable clock. `sleep` advances it rather than waiting, so the suite asserts the
 * schedule the limiter chose instead of measuring wall-clock time — which would be both slow
 * and flaky.
 */
function testClock(): LimiterDeps & { readonly slept: number[]; advance: (ms: number) => void } {
  let clock = 0;
  const slept: number[] = [];
  return {
    slept,
    advance: (ms) => {
      clock += ms;
    },
    now: () => clock,
    sleep: async (ms) => {
      slept.push(ms);
      clock += ms;
    },
  };
}

describe('RateLimiter', () => {
  it('lets the window budget through without delay', async () => {
    const deps = testClock();
    const limiter = new RateLimiter({ requests: 3, windowMs: 1000 }, deps);

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    expect(deps.slept).toEqual([]);
  });

  it('waits for the oldest request to leave the window once the budget is spent', async () => {
    const deps = testClock();
    const limiter = new RateLimiter({ requests: 2, windowMs: 1000 }, deps);

    await limiter.acquire();
    deps.advance(400);
    await limiter.acquire();

    // Budget spent. The oldest request was at t=0, so the window frees at t=1000, and we are
    // at t=400.
    await limiter.acquire();
    expect(deps.slept).toEqual([600]);
  });

  it('slides the window rather than bucketing it', async () => {
    // Fixed buckets permit 2N requests across a boundary — N at the end of one window and N at
    // the start of the next. That burst is exactly what the budget exists to prevent.
    const deps = testClock();
    const limiter = new RateLimiter({ requests: 2, windowMs: 1000 }, deps);

    await limiter.acquire();
    await limiter.acquire();
    deps.advance(999);

    await limiter.acquire();
    expect(deps.slept).toEqual([1]);
  });

  it('enforces a minimum interval even when the budget is untouched', async () => {
    // A budget alone permits spending the whole allowance in one burst, which is the shape
    // that trips a source's protection.
    const deps = testClock();
    const limiter = new RateLimiter({ requests: 100, windowMs: 60_000, minIntervalMs: 250 }, deps);

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    expect(deps.slept).toEqual([250, 250]);
  });

  it('does not delay when the caller was already slower than the minimum interval', async () => {
    const deps = testClock();
    const limiter = new RateLimiter({ requests: 100, windowMs: 60_000, minIntervalMs: 250 }, deps);

    await limiter.acquire();
    deps.advance(400);
    await limiter.acquire();

    expect(deps.slept).toEqual([]);
  });

  it('takes the longer of the two constraints, never their sum', async () => {
    const deps = testClock();
    const limiter = new RateLimiter({ requests: 2, windowMs: 1000, minIntervalMs: 100 }, deps);

    await limiter.acquire(); // t=0
    await limiter.acquire(); // interval only: sleeps 100, lands at t=100

    // The budget is now spent and the oldest request was at t=0, so the window frees at t=1000.
    // The third acquire owes 900 more — not 100 (interval) + 900 (window) in series, which
    // would land at t=1100 and is what taking both constraints additively would produce.
    await limiter.acquire();

    expect(deps.slept).toEqual([100, 900]);
    expect(deps.now()).toBe(1000);
  });

  it('keeps admitting at a steady rate over a long run', async () => {
    const deps = testClock();
    const limiter = new RateLimiter({ requests: 5, windowMs: 1000 }, deps);

    for (let i = 0; i < 20; i += 1) await limiter.acquire();

    // 20 requests at 5 per second cannot finish before the fourth window opens.
    expect(deps.now()).toBeGreaterThanOrEqual(3000);
  });
});
