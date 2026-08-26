/**
 * PostCSS, which exists here for exactly one reason: Tailwind v4 (ADR-0023).
 *
 * Next.js styles plain CSS with no configuration at all. This file ends that, and the ADR records
 * it as an accepted cost rather than an incidental change — a build step is a decision (ADR-0014
 * set that precedent). Nothing else belongs in this pipeline: an autoprefixer or a nesting plugin
 * added here would be a second styling mechanism arriving without a decision.
 */

/** @type {import('postcss-load-config').Config} */
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
