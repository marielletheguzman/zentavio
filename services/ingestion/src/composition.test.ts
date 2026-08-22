import { describe, expect, it } from 'vitest';

import { composeArchive, type IngestionConfig } from './composition.ts';

const CONFIG: IngestionConfig = { leverBoards: 'leverdemo', leverApiBase: 'https://api.lever.co' };

const DEPS = {
  db: null as never,
  newId: () => '01a02a0b-7d56-7000-ac78-ae9ca35746f2',
  now: () => new Date('2026-08-23T00:00:00Z'),
};

describe('the archive store', () => {
  it('is absent when storage is not configured', () => {
    // A run then reports `not-configured` rather than recording documents that do not exist.
    expect(composeArchive(CONFIG, DEPS)).toBeUndefined();
  });

  it('is absent when storage is half-configured', () => {
    // Three of four keys is not a store, and a partial configuration failing at write time would
    // surface as a lost archive rather than a missing setting.
    expect(composeArchive({ ...CONFIG, storageEndpoint: 'http://127.0.0.1:9000' }, DEPS)).toBeUndefined();
    expect(
      composeArchive({ ...CONFIG, storageEndpoint: 'http://127.0.0.1:9000', storageBucket: 'b' }, DEPS),
    ).toBeUndefined();
  });

  it('is built when all four required keys are present', () => {
    const archive = composeArchive(
      {
        ...CONFIG,
        storageEndpoint: 'http://127.0.0.1:9000',
        storageBucket: 'zentavio-documents',
        storageAccessKeyId: 'zentavio',
        storageSecretAccessKey: 'secret',
      },
      DEPS,
    );

    expect(archive?.store).toBeDefined();
  });
});
