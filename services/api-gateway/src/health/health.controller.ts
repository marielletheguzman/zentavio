/**
 * Liveness and readiness (`.claude/skills/backend-service/SKILL.md`).
 *
 * **Readiness checks real dependencies.** A probe that always returns 200 is a lie, and the lie is
 * expensive: an orchestrator routes traffic to a gateway that cannot reach its database, and every
 * request fails with a 500 instead of the instance being pulled out.
 */

import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Database } from '@zentavio/db';
import { DATABASE } from '../tokens.ts';

@Controller('health')
export class HealthController {
  readonly #db: Kysely<Database>;

  constructor(@Inject(DATABASE) db: Kysely<Database>) {
    this.#db = db;
  }

  /** The process is up. Nothing else is claimed, so this must not touch a dependency. */
  @Get('live')
  live(): { status: string } {
    return { status: 'live' };
  }

  @Get('ready')
  async ready(): Promise<{ status: string; checks: Record<string, string> }> {
    try {
      await sql`select 1`.execute(this.#db);
    } catch {
      // The reason is deliberately absent from the response: a connection error can carry a host,
      // a port, and sometimes a credential. It belongs in a log, not in an unauthenticated probe.
      throw new ServiceUnavailableException('A dependency is unavailable.');
    }
    return { status: 'ready', checks: { database: 'ok' } };
  }
}
