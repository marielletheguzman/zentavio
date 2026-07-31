// Deliberately broken. Exists only to make `pnpm typecheck` fail, so the branch
// protection on `main` can be tested by attempting to violate it (ADR-0011).
// This file and its branch are deleted once the merge has been refused.
export const probe: number = 'this is not a number';
