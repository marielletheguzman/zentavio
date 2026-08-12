/**
 * Whether a date control's value is a date this product can ask a question about.
 *
 * **This exists because `<input type="date">` can hand back a five-digit year.** Typing into the
 * year segment in Chrome produces values like `12025-08-12` — a legitimate value for the control
 * (the HTML date range runs to 275760) and not one the gateway accepts, which requires
 * `YYYY-MM-DD`. Verified in a browser on 2026-08-12 on both surfaces that carry the control.
 *
 * The gateway answers it with a 400, and both panels render a 400 as *"something went wrong on our
 * side"* — which is the right sentence for a 4xx, because a 4xx from our own client is our bug.
 * That makes this the one case where it is false: the input is the problem, and telling somebody
 * their perfectly typed date is our fault leaves them with nothing to do.
 *
 * Shared rather than copied into each panel, because a second copy is what lets one surface get
 * fixed and the other keep lying.
 */

/**
 * `null` when the value can be sent, or the sentence to show when it cannot.
 *
 * Returns the message rather than a boolean so the wording cannot drift between callers, and so a
 * caller cannot invent a vaguer one.
 */
export function asOfProblem(value: string): string | null {
  // Deliberately *not* a full date check. The control cannot emit `2026-02-31`, and a second
  // calendar implementation here would be a second thing to keep correct — the gateway parses the
  // date and is authoritative. This catches the one shape the control produces and the server
  // refuses.
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? null
    : 'That date cannot be used. Use a four-digit year, as 2026-08-12.';
}
