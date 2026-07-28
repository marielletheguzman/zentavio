/**
 * Zentavio's actual configuration schema.
 *
 * **Only keys something reads today.** The areas anticipated in
 * `docs/development/environment.md` — PostgreSQL, Redis, Qdrant, connector credentials, billing —
 * are deliberately absent: declaring a key before anything reads it means the first reader
 * inherits an untested default, and `.env.example` starts lying about what is needed.
 *
 * Adding a key: define it here, add it to `.env.example`, read it only through this package.
 */

import type { Schema } from './schema.js';

/**
 * The eval runner reads these two today (`ai/shared/evals/model.py`). They are duplicated there
 * as Python `os.environ` defaults, which is the polyglot cost ADR-0003 accepted — the names and
 * defaults must stay in step, and this file is the source of truth for both.
 */
export const evalSchema = {
  ollamaHost: {
    env: 'OLLAMA_HOST',
    type: 'url',
    protocols: ['http', 'https'],
    default: 'http://127.0.0.1:11434',
    description: 'Ollama host for graded prompt evals (ADR-0009)',
  },
  evalModel: {
    env: 'ZENTAVIO_EVAL_MODEL',
    type: 'string',
    minLength: 1,
    default: 'qwen2.5:7b-instruct',
    description: 'Pinned model for graded evals, so delta reports are comparable between machines',
  },
} as const satisfies Schema;

/**
 * The whole schema. One object so `envKeys` can generate the complete `.env.example`, and so a
 * reader cannot forget a section exists.
 */
export const zentavioSchema = {
  ...evalSchema,
} as const satisfies Schema;

export type ZentavioConfig = {
  readonly [K in keyof typeof zentavioSchema]: (typeof zentavioSchema)[K] extends {
    type: 'number';
  }
    ? number
    : (typeof zentavioSchema)[K] extends { type: 'boolean' }
      ? boolean
      : string;
};
