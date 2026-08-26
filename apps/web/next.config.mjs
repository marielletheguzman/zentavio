/**
 * Next.js configuration.
 *
 * `transpilePackages` is what makes the workspace packages usable here: `@zentavio/types` exports
 * `./src/index.ts` directly (there is no build step for packages — ADR-0014), so Next must compile
 * it rather than expect published JavaScript.
 */

import { fileURLToPath } from 'node:url';

/**
 * The monorepo root, stated rather than inferred.
 *
 * Next walks upward looking for a lockfile and takes the first one it finds. On this machine that
 * found `C:\Users\Marielle\package-lock.json` — a stray file outside the repository entirely — and
 * every build warned that it had chosen a home directory as the workspace root. It is a warning
 * today and a wrong build-trace tomorrow: file tracing rooted above the repository decides which
 * files a deployment carries.
 */
const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url));

/** @type {import('next').NextConfig} */
export default {
  transpilePackages: ['@zentavio/types'],
  eslint: { ignoreDuringBuilds: true },
  outputFileTracingRoot: workspaceRoot,
};
