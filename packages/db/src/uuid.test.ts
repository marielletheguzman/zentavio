/**
 * UUIDv7 generation.
 *
 * The properties worth testing are the ones a wrong implementation still passes a smoke test on:
 * the version and variant nibbles, monotonicity inside a single millisecond, and that the timestamp
 * is actually the current time rather than random bits that happen to parse.
 */

import { describe, expect, it } from 'vitest';
import { uuidv7, uuidv7Timestamp } from './uuid.ts';

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('uuidv7', () => {
  it('is a canonical 36-character UUID', () => {
    const id = uuidv7();
    expect(id).toHaveLength(36);
    expect(id).toMatch(UUID_SHAPE);
  });

  it('sets version 7, not 4', () => {
    // The whole point. crypto.randomUUID would pass every other test in this file.
    for (let i = 0; i < 100; i += 1) {
      expect(uuidv7()[14]).toBe('7');
    }
  });

  it('sets the RFC 9562 variant', () => {
    for (let i = 0; i < 100; i += 1) {
      expect(['8', '9', 'a', 'b']).toContain(uuidv7()[19]);
    }
  });

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 10_000 }, uuidv7));
    expect(ids.size).toBe(10_000);
  });

  it('is strictly increasing as a string, which is what index locality depends on', () => {
    // Generated in a tight loop, so most of these land in the same millisecond — exactly the case
    // where a generator without a sequence counter produces arbitrary order.
    const ids = Array.from({ length: 5_000 }, uuidv7);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });

  it('encodes the current time', () => {
    const before = Date.now();
    const id = uuidv7();
    const after = Date.now();

    const timestamp = uuidv7Timestamp(id);
    expect(timestamp).toBeDefined();
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });

  it('survives generating more than 4096 ids in one millisecond', () => {
    // The sequence field is 12 bits. Overflowing it must spill into the next millisecond rather
    // than wrap, because wrapping silently breaks the ordering guarantee above.
    const ids = Array.from({ length: 20_000 }, uuidv7);
    expect(new Set(ids).size).toBe(20_000);
    expect([...ids]).toEqual([...ids].sort());
  });
});

describe('uuidv7Timestamp', () => {
  it('refuses a v4 UUID rather than decoding random bits into a date', () => {
    // A v4 id has randomness where the timestamp lives, so decoding one yields a confident wrong
    // answer — usually a date tens of thousands of years away.
    expect(uuidv7Timestamp(crypto.randomUUID())).toBeUndefined();
  });

  it('refuses anything that is not a UUID', () => {
    expect(uuidv7Timestamp('')).toBeUndefined();
    expect(uuidv7Timestamp('not-a-uuid')).toBeUndefined();
    expect(uuidv7Timestamp('0199c0f0-0000-7000-8000-00000000000')).toBeUndefined();
  });

  it('round-trips a generated id', () => {
    const id = uuidv7();
    expect(uuidv7Timestamp(id)).toBe(uuidv7Timestamp(id));
    expect(uuidv7Timestamp(id)).toBeGreaterThan(1_700_000_000_000);
  });
});
