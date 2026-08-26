/**
 * Class-name joining, written here rather than installed.
 *
 * `clsx` is four lines of logic and is **explicitly not approved** by ADR-0023 — that ADR approves
 * the shadcn *vendoring pattern* and nothing else, and names `clsx` among the transitive
 * dependencies each PR must justify separately. Installing it to avoid writing this would be the
 * "dependency creep through shadcn" risk the ADR lists, arriving without the component that was
 * supposed to justify it.
 *
 * It deliberately does **not** do what `tailwind-merge` does — resolving conflicts between two
 * utilities that set the same property. That is a real problem and this is not a solution to it;
 * the components here avoid it by taking variants as props rather than by accepting arbitrary
 * `className` overrides that fight their own defaults.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => typeof part === 'string' && part !== '').join(' ');
}
