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
          // NOTE: no tests exist in this project yet, and that is correct rather than an
          // oversight. It needs `packages/db` and migrations to exist first — see ADR-0007's
          // follow-up work. A container helper written now would be a helper for a database
          // that does not exist.
        },
      },
    ],
  },
});
