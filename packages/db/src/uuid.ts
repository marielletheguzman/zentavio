/**
 * UUIDv7 generation.
 *
 * The schema documents UUIDv7 primary keys generated in the application
 * (`docs/database/README.md`, `.claude/skills/database/SKILL.md`). Until this existed, every row
 * written by a test used `crypto.randomUUID`, which is v4 — so the schema said one thing and every
 * id in the database said another.
 *
 * **Why v7 rather than v4.** The first 48 bits are a millisecond timestamp, so ids sort by creation
 * time. That gives index locality on insert — consecutive rows land in the same B-tree page instead
 * of scattering across the whole index — and a free creation ordering that survives a clock the
 * application does not control.
 *
 * No dependency: v7 is 128 bits of layout over a timestamp and randomness, and `node:crypto` already
 * supplies the randomness. Adding a package for this would need an ADR
 * (`.claude/context/tech-stack.md`) and would buy nothing.
 */

import { randomFillSync } from 'node:crypto';

/**
 * Monotonic guard.
 *
 * Two ids generated inside the same millisecond would otherwise order arbitrarily, which quietly
 * breaks the one property v7 is chosen for. RFC 9562 method 2: keep a counter in the 12 bits that
 * follow the timestamp and increment it within a millisecond.
 *
 * Reset whenever the millisecond changes, including backwards — a clock that steps back must not
 * carry a high counter forward and exhaust the space.
 */
let lastTimestamp = -1;
let sequence = 0;

/** 12 bits of `rand_a` are used as the sequence, so this is the point at which it must spill. */
const SEQUENCE_MAX = 0xfff;

function hex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/**
 * A UUIDv7 as the canonical 36-character string.
 *
 * Layout (RFC 9562):
 *
 * ```text
 * unix_ts_ms (48) | ver (4) | rand_a / sequence (12) | var (2) | rand_b (62)
 * ```
 *
 * Ids generated within one millisecond are strictly increasing. Across milliseconds, ordering
 * follows the clock — so a backwards system clock can produce an id that sorts before its
 * predecessor. That is accepted: the alternative is a generator that invents timestamps, and a
 * primary key is not the right place to paper over a broken clock. Ordering is a convenience here,
 * never a correctness guarantee — nothing reads creation order from the key, `created_at` is what
 * answers "when".
 */
export function uuidv7(): string {
  const now = Date.now();

  if (now === lastTimestamp) {
    sequence += 1;
    if (sequence > SEQUENCE_MAX) {
      // More than 4096 ids in one millisecond. Spilling into the next millisecond keeps the
      // monotonic guarantee; wrapping the counter would silently break it.
      let next = Date.now();
      while (next === now) next = Date.now();
      lastTimestamp = next;
      sequence = 0;
    }
  } else {
    lastTimestamp = now;
    sequence = 0;
  }

  const timestamp = lastTimestamp;
  const bytes = new Uint8Array(16);

  // 48-bit big-endian millisecond timestamp. Number is exact here: Date.now() is well inside
  // 2^53, and the shifts below avoid the 32-bit truncation that `>>>` would impose.
  bytes[0] = Math.floor(timestamp / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(timestamp / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(timestamp / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(timestamp / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(timestamp / 2 ** 8) & 0xff;
  bytes[5] = timestamp & 0xff;

  // rand_b, the low 62 bits, is pure randomness. Filled before the version and variant nibbles are
  // written so nothing overwrites them.
  randomFillSync(bytes, 8, 8);

  // ver = 7 in the high nibble of byte 6, sequence in the remaining 12 bits.
  bytes[6] = 0x70 | ((sequence >>> 8) & 0x0f);
  bytes[7] = sequence & 0xff;

  // var = 0b10 in the two high bits of byte 8.
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);

  const h = hex(bytes);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * The millisecond a v7 id was generated at, for tests and for reading an id in an incident.
 *
 * Returns `undefined` for anything that is not a v7 UUID rather than a plausible date — a v4 id has
 * random bits exactly where the timestamp would be, so decoding one yields a confident wrong answer.
 */
export function uuidv7Timestamp(id: string): number | undefined {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return undefined;
  }
  return Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
}
