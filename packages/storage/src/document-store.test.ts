import { describe, expect, it } from 'vitest';

import { IntegrityError, ObjectNotFoundError, objectKeyFor } from './document-store.ts';
import { MemoryDocumentStore, sha256Of } from './memory-store.ts';

const BYTES = new TextEncoder().encode('BAnz AT 18.12.2025 B3');

describe('objectKeyFor', () => {
  it('produces the documented shape', () => {
    expect(
      objectKeyFor({
        category: 'immigration',
        jurisdiction: 'DE',
        year: 2026,
        slug: 'BAnz AT 18.12.2025 B3',
        extension: 'pdf',
      }),
    ).toBe('immigration/de/2026/banz-at-18-12-2025-b3.pdf');
  });

  it('is deterministic — the same record always yields the same key', () => {
    // A key that cannot be recomputed from its record cannot be audited: you would have to trust
    // the stored string rather than check it.
    const parts = {
      category: 'immigration',
      jurisdiction: 'DE',
      year: 2026,
      slug: 'eu-blue-card',
      extension: 'pdf',
    };
    expect(objectKeyFor(parts)).toBe(objectKeyFor(parts));
  });

  it('collapses case and punctuation, so one document cannot land under two keys', () => {
    const a = objectKeyFor({ category: 'Immigration', jurisdiction: 'de', year: 2026, slug: 'EU  Blue—Card', extension: 'PDF' });
    const b = objectKeyFor({ category: 'immigration', jurisdiction: 'DE', year: 2026, slug: 'eu blue card', extension: 'pdf' });
    expect(a).toBe(b);
  });

  it('leaves no leading or trailing separators', () => {
    const key = objectKeyFor({ category: '  immigration  ', jurisdiction: 'DE', year: 2026, slug: '--x--', extension: 'pdf' });
    expect(key).toBe('immigration/de/2026/x.pdf');
  });
});

describe('put', () => {
  it('returns the checksum of what was stored', async () => {
    const store = new MemoryDocumentStore();
    const ref = await store.put({ key: 'a/b/2026/c.pdf', body: BYTES, contentType: 'application/pdf' });

    expect(ref.sha256).toBe(sha256Of(BYTES));
    expect(ref.sizeBytes).toBe(BYTES.byteLength);
  });

  it('copies on write, so a later mutation cannot change what is stored', async () => {
    // No real object store would let a caller's buffer keep mutating the stored object, and no
    // test should be able to depend on it.
    const store = new MemoryDocumentStore();
    const mutable = Uint8Array.from(BYTES);
    const ref = await store.put({ key: 'k', body: mutable, contentType: 'application/pdf' });

    mutable[0] = 0;

    await expect(store.get('k', ref.sha256)).resolves.toBeInstanceOf(Uint8Array);
  });
});

describe('get verifies rather than trusts', () => {
  it('returns the bytes when the checksum matches', async () => {
    const store = new MemoryDocumentStore();
    const ref = await store.put({ key: 'k', body: BYTES, contentType: 'application/pdf' });

    expect(await store.get('k', ref.sha256)).toEqual(BYTES);
  });

  it('throws when the stored bytes changed after archiving', async () => {
    // The whole reason to archive a source is that a claim derived from it can be re-checked. A
    // document that changed since is not the document the claim was made from — and R2's audit
    // logging is weaker than S3's, so this checksum is the evidence (ADR-0021).
    const store = new MemoryDocumentStore();
    const ref = await store.put({ key: 'k', body: BYTES, contentType: 'application/pdf' });

    store.corrupt('k', new TextEncoder().encode('something else'));

    await expect(store.get('k', ref.sha256)).rejects.toThrow(IntegrityError);
  });

  it('names both checksums, so a mismatch is diagnosable', async () => {
    const store = new MemoryDocumentStore();
    const ref = await store.put({ key: 'k', body: BYTES, contentType: 'application/pdf' });
    store.corrupt('k', new TextEncoder().encode('x'));

    await expect(store.get('k', ref.sha256)).rejects.toThrow(/expected .*, read /);
  });

  it('throws a distinct error when the object is absent', async () => {
    // "Not there" and "there but altered" are different incidents.
    const store = new MemoryDocumentStore();
    await expect(store.get('missing', 'deadbeef')).rejects.toThrow(ObjectNotFoundError);
  });
});

describe('the rest of the port', () => {
  it('reports existence without reading the bytes', async () => {
    const store = new MemoryDocumentStore();
    expect(await store.exists('k')).toBe(false);

    await store.put({ key: 'k', body: BYTES, contentType: 'application/pdf' });
    expect(await store.exists('k')).toBe(true);
  });

  it('deletes, which is for lifecycle expiry and never for evidence', async () => {
    const store = new MemoryDocumentStore();
    await store.put({ key: 'k', body: BYTES, contentType: 'application/pdf' });

    await store.delete('k');
    expect(await store.exists('k')).toBe(false);
  });

  it('refuses to sign a URL for something that is not there', async () => {
    // A signed URL to nothing is a link a user will click and blame us for.
    const store = new MemoryDocumentStore();
    await expect(store.createSignedUrl('missing', 60)).rejects.toThrow(ObjectNotFoundError);
  });

  it('signs a time-limited URL for a stored object', async () => {
    const store = new MemoryDocumentStore();
    await store.put({ key: 'k', body: BYTES, contentType: 'application/pdf' });

    expect(await store.createSignedUrl('k', 300)).toContain('expires=300');
  });
});
