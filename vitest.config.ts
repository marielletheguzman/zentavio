import { defineConfig } from 'vitest/config';

// ADR-0007. Two projects, because they have different costs and different triggers:
//
//   unit         fast, no external services. Runs on every save and in `lint:all`.
//   integration  real containerized PostgreSQL. Its own CI job so failure is legible.
//
// No coverage threshold, deliberately (ADR-0007): a number invites tests written to satisfy
// it, and the invariant list in docs/development/testing.md is the real bar.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: [
            'tools/**/*.test.{ts,mts,mjs}',
            'packages/**/*.test.ts',
            'services/**/*.test.ts',
            'connectors/**/*.test.ts',
            'knowledge-engine/**/*.test.ts',
            'apps/**/*.test.{ts,tsx}',
            'tests/unit/**/*.test.ts',
          ],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          // Integration tests share a database, so they must not race each other.
          fileParallelism: false,
          testTimeout: 30_000,
          // Requires a running PostgreSQL and ZENTAVIO_TEST_DATABASE_URL:
          //
          //   docker compose -f infra/docker/docker-compose.dev.yml up -d --wait
          //
          // The suite drops and rebuilds its schema on every run, so tests/integration/db/database.ts
          // refuses any database whose name does not end in `_test`.
        },
      },
    ],
  },
});
