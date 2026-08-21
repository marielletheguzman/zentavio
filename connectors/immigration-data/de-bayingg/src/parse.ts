/**
 * Pure parsing of BayIngG Art. 2 and Art. 3.
 *
 * Everything here is a pure function over a string, so `normalize` can call it and stay pure.
 *
 * ## What this reads, and what it refuses to
 *
 * Bavaria protects the **title** `Ingenieurin` / `Ingenieur`, not the activity. Art. 2 says who may
 * use it; Art. 3 says how someone trained abroad obtains permission. Two provisions are literal
 * enough to become rules:
 *
 * | Provision | Why it is extractable |
 * |---|---|
 * | Art. 2 Abs. 1 Nr. 1 b) — at least six semesters, at least 180 ECTS | two numbers with fixed units |
 * | Art. 2 Abs. 1 Nr. 2 with Art. 3 — permission after foreign training | a single stated document |
 *
 * **Everything else is left unmodelled on purpose.** Art. 3 Abs. 1's equivalence test routes
 * through the BayBQFG, whose text is not on this page; Abs. 2's one-year practice rule applies only
 * where the profession is unregulated *in a member or contracting state*, which is a status this
 * connector cannot determine; Abs. 3 equates Directive 2005/36/EC programmes. Modelling any of them
 * from this page would produce a rule that looks authoritative and is subtly wrong.
 *
 * ## The trap this file is written around
 *
 * `gesetze-bayern.de` serves the article text inside an application shell, and the same page
 * carries navigation listing **other** articles by number. A pattern that scans the whole document
 * for "180" or "sechs" would find whatever the shell happens to contain. So every extraction is
 * anchored on the provision's own wording, and the numbers are read from words as well as digits —
 * the statute writes `sechs Semestern`, not `6 Semestern`.
 */

/** The statute writes small numbers as words. A closed map, because a guess here is a wrong rule. */
const NUMBER_WORDS: ReadonlyMap<string, number> = new Map([
  ['drei', 3],
  ['vier', 4],
  ['fünf', 5],
  ['sechs', 6],
  ['sieben', 7],
  ['acht', 8],
  ['neun', 9],
  ['zehn', 10],
]);

/** What the two articles state, or `null` for anything this refuses to guess at. */
export interface BayIngGParsed {
  /** Art. 2 Abs. 1 Nr. 1 b) — `Regelstudienzeit von mindestens sechs Semestern in Vollzeit`. */
  readonly minimumSemesters: number | null;
  /** Art. 2 Abs. 1 Nr. 1 b) — `bei Anwendung des ECTS-Systems mindestens 180 Punkte`. */
  readonly minimumEctsCredits: number | null;
  /** Art. 2 Abs. 1 Nr. 2 — a foreign qualification needs `die Genehmigung hierzu`. */
  readonly requiresPermissionAfterForeignTraining: boolean;
  /**
   * Art. 3 Abs. 4 — evidence from outside the EU/EEA must confirm a course meeting Art. 2 Abs. 1
   * Nr. 1's requirements. This is what makes the two numeric rules apply to a third-country
   * qualification rather than being about German degrees only.
   */
  readonly thirdCountryEvidenceMustMatchArt2: boolean;
}

/** Tags, entities and collapsed whitespace out; the words the statute uses, intact. */
export function toPlainText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    // **Numeric entities, and this is the trap.** The portal serves `Gesch&#xFC;tzte`, not
    // `Geschützte`. Every anchor in this file keys on a German word, so without this step each
    // pattern misses and the connector reports *no rules* — silence, which reads as "the law says
    // nothing" rather than as a failure. `de-aufenthg` documents the same class of bug against
    // § 18g's ISO-8859-1 encoding; this is that bug in hexadecimal.
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_match, digits: string) =>
      String.fromCodePoint(Number.parseInt(digits, 10)),
    )
    .replace(/&auml;/g, 'ä')
    .replace(/&ouml;/g, 'ö')
    .replace(/&uuml;/g, 'ü')
    .replace(/&Auml;/g, 'Ä')
    .replace(/&Ouml;/g, 'Ö')
    .replace(/&Uuml;/g, 'Ü')
    .replace(/&szlig;/g, 'ß')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A count written as a word or as digits, taken from one anchored fragment.
 *
 * The fragment is the caller's responsibility: passing the whole document here is what the
 * navigation shell would poison.
 */
function countIn(fragment: string, unit: RegExp): number | null {
  const match = unit.exec(fragment);
  if (match === null) return null;

  const token = (match[1] ?? '').toLowerCase();
  if (/^\d+$/.test(token)) {
    const value = Number.parseInt(token, 10);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  return NUMBER_WORDS.get(token) ?? null;
}

/**
 * The slice of text belonging to one article, so a later article's numbers cannot leak into an
 * earlier one's rule.
 *
 * **Why this is not simply "from the first `Art. n` to the next".** The portal wraps each article
 * in an application shell whose navigation names every article of the law, in order, before the
 * body text. Anchoring on the first occurrence produces a slice that ends at the navigation's link
 * to the next article — a heading and nothing else. That is exactly what the connector's first
 * version did, and it read no provisions at all.
 *
 * So every occurrence is considered and the **longest** resulting slice wins: the shell's mentions
 * are links, and the body is the only place the article is set out in full. Returns the whole text
 * when the heading is absent, because a page that does not name its article is a page whose shape
 * changed — the caller's own anchors then fail, which is the outcome we want over a silent wrong
 * number.
 */
export function articleText(plain: string, article: number): string {
  const heading = new RegExp(`Art\.\s*${String(article)}\b`, 'g');
  const next = new RegExp(`Art\.\s*${String(article + 1)}\b`);

  let longest = '';
  for (const match of plain.matchAll(heading)) {
    const rest = plain.slice(match.index);
    const end = next.exec(rest);
    const slice = end === null ? rest : rest.slice(0, end.index);
    if (slice.length > longest.length) longest = slice;
  }

  return longest === '' ? plain : longest;
}

/**
 * Read both articles.
 *
 * **They arrive as two documents because the portal serves one article per page**, and they are
 * parsed together because neither is a rule alone: Art. 2 states numbers about German degrees, and
 * only Art. 3 Abs. 4 makes them the test a third-country qualification is measured against.
 * Anything not stated literally comes back `null` or `false`.
 */
export function parseBayIngG(art2Html: string, art3Html: string): BayIngGParsed {
  const art2 = articleText(toPlainText(art2Html), 2);
  const art3 = articleText(toPlainText(art3Html), 3);

  // `Regelstudienzeit von mindestens sechs Semestern` — the number sits between the two anchors,
  // and both anchors are Art. 2's own wording.
  const minimumSemesters = countIn(
    art2,
    /Regelstudienzeit\s+von\s+mindestens\s+([A-Za-zäöüß]+|\d+)\s+Semester/i,
  );

  // **The fixture caught this.** The statute does not say "mindestens 180 ECTS": it says
  // `bei Anwendung des ECTS-Systems mindestens 180 Punkte erworben werden können`. A pattern
  // written from the summary rather than from the page reads nothing and reports no rule, which is
  // silent. Anchored on both halves, in the order the sentence uses them.
  const minimumEctsCredits = countIn(art2, /ECTS-Systems\s+mindestens\s+(\d+)\s+Punkte/i);

  // Art. 2 Abs. 1 Nr. 2 in full is "wer nach Ausbildung im Ausland die Genehmigung hierzu erhalten
  // hat". Anchored on both halves: "Genehmigung" alone appears in Art. 3's heading too.
  const requiresPermissionAfterForeignTraining =
    /Ausbildung\s+im\s+Ausland/i.test(art2) && /Genehmigung/i.test(art2);

  // Art. 3 Abs. 4: evidence from a non-member state "müssen ein den Anforderungen gemäß Art. 2
  // Abs. 1 Nr. 1 entsprechendes Studium bestätigen".
  const thirdCountryEvidenceMustMatchArt2 =
    /Art\.\s*2\s+Abs\.\s*1\s+Nr\.\s*1/i.test(art3) && /Studium\s+best[äa]tigen/i.test(art3);

  return {
    minimumSemesters,
    minimumEctsCredits,
    requiresPermissionAfterForeignTraining,
    thirdCountryEvidenceMustMatchArt2,
  };
}
