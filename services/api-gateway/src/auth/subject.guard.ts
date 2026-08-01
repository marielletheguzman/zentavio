/**
 * Establishes the subject for every request, or refuses it.
 *
 * `docs/architecture/security.md`: the gateway is the only component that authenticates, and deny by
 * default — a route without an explicit policy is unreachable, not public. This guard is applied
 * **globally** for that reason: opting a route *in* to protection is a list someone forgets to
 * update, and the route they forget is the one that leaks.
 */

import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { UnauthenticatedError, type Subject, type SubjectResolver } from '@zentavio/auth';
import { SUBJECT_RESOLVER } from '../tokens.ts';

/** Where the resolved subject is stashed for `@CurrentSubject()` to read. */
export const SUBJECT_KEY = Symbol('zentavio.subject');

interface RequestWithSubject {
  headers: Record<string, string | string[] | undefined>;
  [SUBJECT_KEY]?: Subject;
}

@Injectable()
export class SubjectGuard implements CanActivate {
  readonly #resolver: SubjectResolver;

  constructor(@Inject(SUBJECT_RESOLVER) resolver: SubjectResolver) {
    this.#resolver = resolver;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithSubject>();

    const headers = new Map<string, string>();
    for (const [name, value] of Object.entries(request.headers)) {
      if (typeof value === 'string') headers.set(name.toLowerCase(), value);
    }

    try {
      request[SUBJECT_KEY] = await this.#resolver.resolve(headers);
      return true;
    } catch (error) {
      if (error instanceof UnauthenticatedError) {
        // Deliberately the same response for every reason. Distinguishing expired from forged from
        // absent gives an attacker a signal about what to try next.
        throw new UnauthorizedException('Not authenticated.');
      }
      throw error;
    }
  }
}
