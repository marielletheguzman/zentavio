/**
 * Reads the subject the guard established.
 *
 * This is the only way a controller learns who is calling. There is deliberately no path from the
 * request body to a user id — `userId` in a DTO was the hole, and removing the parameter removes the
 * temptation along with it.
 */

import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Subject } from '@zentavio/auth';
import { SUBJECT_KEY } from './subject.guard.ts';

export const CurrentSubject = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Subject => {
    const request = context.switchToHttp().getRequest<{ [SUBJECT_KEY]?: Subject }>();
    const subject = request[SUBJECT_KEY];
    if (!subject) {
      // Unreachable while the guard is global. Throwing rather than returning a fake keeps it
      // unreachable — a placeholder subject here would be an authentication bypass.
      throw new Error('No subject on the request: the SubjectGuard did not run.');
    }
    return subject;
  },
);
