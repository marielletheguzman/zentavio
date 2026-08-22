/**
 * What this service needs to run, composed from configuration.
 *
 * **The half that names sources is not here.** `connectors/core/src/default-deps.ts` builds their
 * dependencies, because naming a connector from a service is what ADR-0002 forbids and
 * `eslint.config.mjs` refuses — this module was written there first and the rule rejected it. What
 * remains is the archive store and the runner's own dependencies, neither of which knows that any
 * particular source exists.
 */

import { composeRegistry, type SourceConfig, type SourceRuntime } from '@zentavio/connectors-core/registry';
import type { Database } from '@zentavio/db';
import { S3DocumentStore } from '@zentavio/storage';
import type { Kysely } from 'kysely';

import type { ArchiveDeps } from './archive.ts';
import type { RunnerDeps } from './posting-runner.ts';

/** The configuration this service reads. Passed in rather than loaded here, so a test can vary it. */
export interface IngestionConfig extends SourceConfig {
  readonly storageEndpoint?: string;
  readonly storageRegion?: string;
  readonly storageBucket?: string;
  readonly storageAccessKeyId?: string;
  readonly storageSecretAccessKey?: string;
  readonly storageProvider?: string;
}

export interface CompositionDeps extends SourceRuntime {
  readonly db: Kysely<Database>;
  readonly newId: () => string;
}

/**
 * The archive store, when one is configured.
 *
 * **Returns `undefined` rather than a fake when storage is not configured**, so a run reports
 * `not-configured` instead of recording documents that do not exist. ADR-0021's production bucket is
 * unprovisioned; a development run against MinIO supplies these four keys and gets a real store.
 */
export function composeArchive(config: IngestionConfig, deps: CompositionDeps): ArchiveDeps | undefined {
  const { storageEndpoint, storageBucket, storageAccessKeyId, storageSecretAccessKey } = config;
  if (
    storageEndpoint === undefined ||
    storageBucket === undefined ||
    storageAccessKeyId === undefined ||
    storageSecretAccessKey === undefined ||
    storageEndpoint === '' ||
    storageBucket === ''
  ) {
    return undefined;
  }

  return {
    store: new S3DocumentStore({
      endpoint: storageEndpoint,
      region: config.storageRegion ?? 'auto',
      bucket: storageBucket,
      accessKeyId: storageAccessKeyId,
      secretAccessKey: storageSecretAccessKey,
      provider: config.storageProvider ?? 'minio',
    }),
    db: deps.db,
    newId: deps.newId,
  };
}

/** Everything `runJobBoards` needs, composed from configuration. */
export function composeRunnerDeps(config: IngestionConfig, deps: CompositionDeps): RunnerDeps {
  const archive = composeArchive(config, deps);
  return {
    db: deps.db,
    newId: deps.newId,
    now: deps.now,
    ...(archive === undefined ? {} : { archive }),
  };
}

export { composeRegistry };
