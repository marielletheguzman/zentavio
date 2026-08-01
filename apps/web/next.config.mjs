/**
 * Next.js configuration.
 *
 * `transpilePackages` is what makes the workspace packages usable here: `@zentavio/types` exports
 * `./src/index.ts` directly (there is no build step for packages — ADR-0014), so Next must compile
 * it rather than expect published JavaScript.
 */

/** @type {import('next').NextConfig} */
export default {
  transpilePackages: ['@zentavio/types'],
  eslint: { ignoreDuringBuilds: true },
};
