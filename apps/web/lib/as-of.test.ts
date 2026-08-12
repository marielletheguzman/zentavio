/**
 * The guard on the date control's value.
 *
 * The case that matters is the five-digit year: it is what the control actually emits, it is what
 * a browser found on `/compare` and then on `/eligibility`, and it is the one input that would
 * otherwise be reported to the person as our fault.
 */

import { describe, expect, it } from 'vitest';

import { asOfProblem } from './as-of.ts';

describe('asOfProblem', () => {
  it('accepts what the control normally emits', () => {
    expect(asOfProblem('2026-08-12')).toBeNull();
  });

  it('refuses a five-digit year, which is what typing into the year segment produces', () => {
    // Not hypothetical: Chrome produced exactly this on both surfaces.
    expect(asOfProblem('12025-08-12')).toContain('four-digit year');
  });

  it('refuses an empty value rather than sending one', () => {
    // A cleared date control is empty, and the gateway calls that a missing parameter.
    expect(asOfProblem('')).not.toBeNull();
  });

  it('names the shape it wants, so the message is actionable', () => {
    const message = asOfProblem('12025-08-12');
    expect(message).toContain('2026-08-12');
  });

  it('leaves calendar validity to the gateway', () => {
    // The control cannot emit this, and a second calendar implementation here would be a second
    // thing to keep correct. The server parses the date and refuses what is not one.
    expect(asOfProblem('2026-02-31')).toBeNull();
  });
});
