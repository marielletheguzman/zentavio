/**
 * `.env.example` lists exactly the keys the schema declares.
 *
 * The file calls itself "the discoverable inventory of what configuration exists" and says a key in
 * code but not here is a documentation bug. It was a documentation bug: it drifted through four
 * merged changes and ended up missing seven of fourteen keys, including the one without which no
 * browser can call the API at all.
 *
 * Nothing caught it because the file is prose to every other test in the repository. The symptom
 * was not a red build — it was someone unable to start the stack from the documentation, which is
 * the kind of failure that only shows up when a person tries.
 *
 * Asserted in both directions on purpose. A missing key is undiscoverable configuration; an extra
 * one is a key someone will set expecting it to do something.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { zentavioSchema } from './zentavio.ts';

const ENV_EXAMPLE = fileURLToPath(new URL('../../../.env.example', import.meta.url));

function declaredKeys(): readonly string[] {
  return Object.values(zentavioSchema)
    .map((definition) => definition.env)
    .sort();
}

function documentedKeys(): readonly string[] {
  return readFileSync(ENV_EXAMPLE, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    // `KEY=` with an empty value is a real entry — several keys are deliberately blank, because
    // empty means "denied" rather than "unset by accident".
    .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
    .map((line) => line.slice(0, line.indexOf('=')))
    .sort();
}

describe('.env.example', () => {
  it('documents every key the schema declares', () => {
    const missing = declaredKeys().filter((key) => !documentedKeys().includes(key));
    expect(missing, `add these to .env.example: ${missing.join(', ')}`).toEqual([]);
  });

  it('declares no key the schema does not have', () => {
    // A key here that nothing reads is worse than absent: someone sets it, nothing happens, and
    // they go looking for the bug in their own environment.
    const extra = documentedKeys().filter((key) => !declaredKeys().includes(key));
    expect(extra, `remove these from .env.example, or add them to the schema: ${extra.join(', ')}`).toEqual([]);
  });

  it('never carries a real-looking secret', () => {
    // The file's own rule. A placeholder that looks like a credential gets copied into a .env and
    // then into a screenshot.
    const body = readFileSync(ENV_EXAMPLE, 'utf8');
    expect(body).not.toMatch(/sk-[a-zA-Z0-9]{16,}/);
    expect(body).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\./);
  });
});
