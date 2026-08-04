/**
 * `S3DocumentStore` against real MinIO.
 *
 * This suite is the reason MinIO exists (ADR-0021): development must exercise the **same S3
 * protocol** as production, so the client that will talk to Cloudflare R2 is the client these tests
 * run. A filesystem stub here would mean the real implementation is first executed in production —
 * which is how the gateway shipped with no CORS at all through M1c.
 *
 * The unit suite covers the port's semantics against `MemoryDocumentStore`. What only a real
 * endpoint can prove is here: that `forcePathStyle` is right, that S3's several not-found shapes
 * are all recognised, and that a presigned URL actually resolves.
 */

import { load, storageSchema } from '@zentavio/config';
import { ObjectNotFoundError, IntegrityError, S3DocumentStore, objectKeyFor } from '@zentavio/storage';
import { beforeAll, describe, expect, it } from 'vitest';

// Read through `packages/config` like everything else. `process.env` outside that package fails
// the build (ADR-0005), and a test is not an exception — it is where an undocumented key would
// most easily creep in.
const config = load(storageSchema);

// A fresh bucket per run, so one run cannot see another's objects.
const BUCKET = `${config.storageBucket}-test-${String(Date.now())}`;

const BYTES = new TextEncoder().encode('BAnz AT 18.12.2025 B3 — Mindestgehälter');

let store: S3DocumentStore;

beforeAll(async () => {
  store = new S3DocumentStore({
    endpoint: config.storageEndpoint,
    region: config.storageRegion,
    bucket: BUCKET,
    provider: config.storageProvider,
    accessKeyId: config.storageAccessKeyId,
    secretAccessKey: config.storageSecretAccessKey,
  });

  // Provisioning lives on the store, because it is the only module allowed to hold the SDK — a
  // test importing `CreateBucketCommand` would need an exemption from the rule that keeps the
  // provider behind the port.
  await store.ensureBucket();
});

const KEY = objectKeyFor({
  category: 'immigration',
  jurisdiction: 'DE',
  year: 2026,
  slug: 'BAnz AT 18.12.2025 B3',
  extension: 'pdf',
});

describe('round trip against a real endpoint', () => {
  it('stores and returns the same bytes', async () => {
    const ref = await store.put({ key: KEY, body: BYTES, contentType: 'application/pdf' });

    expect(ref.key).toBe('immigration/de/2026/banz-at-18-12-2025-b3.pdf');
    expect(ref.bucket).toBe(BUCKET);
    expect(ref.provider).toBe('minio');
    expect(ref.sizeBytes).toBe(BYTES.byteLength);

    expect(await store.get(KEY, ref.sha256)).toEqual(BYTES);
  });

  it('survives non-ASCII content', async () => {
    // The documents this archives are German statutes and gazettes. A client that mangles
    // umlauts would corrupt the evidence rather than fail, which is worse.
    const key = 'immigration/de/2026/umlaut.txt';
    const ref = await store.put({ key, body: BYTES, contentType: 'text/plain' });

    const read = await store.get(key, ref.sha256);
    expect(new TextDecoder().decode(read)).toContain('Mindestgehälter');
  });

  it('reports existence', async () => {
    expect(await store.exists(KEY)).toBe(true);
    expect(await store.exists('immigration/de/2026/never-written.pdf')).toBe(false);
  });
});

describe('integrity is checked against the endpoint, not assumed', () => {
  it('throws when the stored bytes no longer match the recorded checksum', async () => {
    // Overwritten out of band, exactly as a compromised or mistakenly re-uploaded object would be.
    const key = 'immigration/de/2026/altered.pdf';
    const ref = await store.put({ key, body: BYTES, contentType: 'application/pdf' });
    await store.put({ key, body: new TextEncoder().encode('different'), contentType: 'application/pdf' });

    await expect(store.get(key, ref.sha256)).rejects.toThrow(IntegrityError);
  });

  it('distinguishes a missing object from an altered one', async () => {
    // S3 signals "no such key" through several error shapes depending on the operation; only a
    // real endpoint proves they are all recognised.
    await expect(store.get('immigration/de/2026/absent.pdf', 'deadbeef')).rejects.toThrow(
      ObjectNotFoundError,
    );
  });
});

describe('signed URLs', () => {
  it('produces a URL that actually resolves to the object', async () => {
    // The property that matters: buckets are private, so this is the only way bytes reach a
    // browser. A URL that signs but does not resolve would only show up in front of a user.
    const url = await store.createSignedUrl(KEY, 60);
    const response = await fetch(url);

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES);
  });

  it('refuses to sign for an object that is not there', async () => {
    // S3 signs a URL for a missing key perfectly happily. A signed link to nothing is one a user
    // clicks and blames us for.
    await expect(store.createSignedUrl('immigration/de/2026/absent.pdf', 60)).rejects.toThrow(
      ObjectNotFoundError,
    );
  });
});

describe('delete', () => {
  it('removes an object', async () => {
    const key = 'cache/de/2026/temporary.json';
    await store.put({ key, body: BYTES, contentType: 'application/json' });

    await store.delete(key);
    expect(await store.exists(key)).toBe(false);
  });
});
