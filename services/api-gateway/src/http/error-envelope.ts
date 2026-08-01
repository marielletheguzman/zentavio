/**
 * The shared error envelope, as an exception filter.
 *
 * `.claude/skills/backend-service/SKILL.md`: every failure returns this shape — never a bare Nest
 * exception body, never a stack trace across the wire. A client that has to branch on two error
 * shapes eventually branches on neither.
 *
 * `retryable` is part of the contract rather than a hint: connectors and the web client both decide
 * whether to retry from it, so a wrong value here becomes a retry storm or a lost request.
 */

import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

/**
 * What this filter needs from the HTTP response, structurally.
 *
 * Deliberately **not** `import type { Response } from 'express'`. `express` is on
 * `.claude/context/tech-stack.md`'s "deliberately not in the stack" list and `eslint.config.mjs`
 * enforces it — which caught this import. The ban's intent is that nothing here is built on express
 * directly; NestJS's platform adapter is a different thing, and a structural type keeps that true
 * rather than arguing about it. It also means swapping to Fastify later touches nothing in this
 * file.
 */
interface HttpResponseLike {
  status(code: number): { json(body: unknown): void };
}

const RETRYABLE_STATUSES = new Set<number>([
  HttpStatus.TOO_MANY_REQUESTS,
  HttpStatus.BAD_GATEWAY,
  HttpStatus.SERVICE_UNAVAILABLE,
  HttpStatus.GATEWAY_TIMEOUT,
]);

export function codeFor(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'VALIDATION_FAILED';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHENTICATED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'CONFLICT';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'RATE_LIMITED';
    case HttpStatus.BAD_GATEWAY:
    case HttpStatus.SERVICE_UNAVAILABLE:
    case HttpStatus.GATEWAY_TIMEOUT:
      return 'UPSTREAM_UNAVAILABLE';
    default:
      return 'INTERNAL';
  }
}

export function isRetryable(status: number): boolean {
  return RETRYABLE_STATUSES.has(status);
}

/** Nest's ValidationPipe puts field errors in `message`; the envelope calls that `details`. */
export function extractDetails(body: unknown): readonly unknown[] {
  if (typeof body === 'object' && body !== null && 'message' in body) {
    const message = (body as { message: unknown }).message;
    if (Array.isArray(message)) return message;
  }
  return [];
}

@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  readonly #logger = new Logger(ErrorEnvelopeFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<HttpResponseLike>();
    const correlationId = randomUUID();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    // An unexpected exception's message may quote the request — and the request here carries a
    // résumé. Only a known HttpException's message crosses the wire; everything else becomes a
    // fixed string and stays in the log.
    const message =
      exception instanceof HttpException ? exception.message : 'The request could not be completed.';

    if (!(exception instanceof HttpException)) {
      // Deliberately no exception body, no stack: this log line may be shipped somewhere, and the
      // request that produced it carries someone's CV. The correlation id is the join key instead.
      this.#logger.error(`unhandled exception correlationId=${correlationId}`);
    }

    response.status(status).json({
      error: {
        code: codeFor(status),
        message,
        details: exception instanceof HttpException ? extractDetails(exception.getResponse()) : [],
        correlationId,
        retryable: isRetryable(status),
      },
    });
  }
}
