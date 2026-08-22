/**
 * Pure parsing of a git-scm.com documentation page.
 *
 * There is exactly one thing to read — the title — and this file is mostly about how little it does.
 * The pages are the Git manual: the prose belongs to the project, and a connector that extracted
 * summaries would be storing a paraphrase of documentation and calling it metadata.
 */

/** What a page yields. `null` where the page shape changed, never a guess. */
export interface DocPageParsed {
  /** `git-stash`, from `<title>Git - git-stash Documentation</title>`. */
  readonly title: string | null;
}

/**
 * The command the page documents.
 *
 * Anchored on the site's own title format rather than on an `<h1>`: the heading is inside the
 * rendered manual page and its markup has changed before, while the `<title>` is the site's.
 * A page that does not match produces `null`, and the connector then produces no row — a resource
 * with a fabricated title sends somebody to a page that is not what we said it was.
 */
export function parseDocPage(html: string): DocPageParsed {
  const match = /<title>\s*Git\s*-\s*(.+?)\s*<\/title>/i.exec(html);
  if (match === null) return { title: null };

  const inner = (match[1] ?? '').replace(/\s+Documentation\s*$/i, '').trim();
  return { title: inner === '' ? null : inner };
}
