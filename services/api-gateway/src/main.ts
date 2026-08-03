/**
 * Bootstrap only: app factory, pipes, filters, shutdown hooks
 * (`.claude/skills/backend-service/SKILL.md`). No routing, no logic.
 *
 * **This service is compiled, not type-stripped** (ADR-0014's 2026-08-01 amendment). NestJS needs
 * decorators and Node's strip-only mode cannot run them, so `services/*` build to `dist/` while
 * scripts and CLIs keep running directly. Run `pnpm --filter @zentavio/api-gateway build` first.
 */

import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { load, parserSchema } from '@zentavio/config';
import { DEV_SUBJECT_HEADER } from '@zentavio/auth';
import { AppModule } from './app.module.ts';
import { ErrorEnvelopeFilter } from './http/error-envelope.ts';

const DEFAULT_PORT = 8080;

export async function bootstrap(port: number = DEFAULT_PORT): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useGlobalPipes(
    new ValidationPipe({
      // Anything not on the DTO is dropped rather than passed through. Without this, an extra field
      // reaches a use case unvalidated, which is the defect the DTO exists to prevent.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new ErrorEnvelopeFilter());

  // **Without this the browser cannot call the gateway at all**, and every check that used a
  // server-side fetch missed it: node does not enforce the same-origin policy, so the whole web
  // surface passed end-to-end verification while being unusable in a browser.
  //
  // Deny by default. An unset origin sends no CORS headers, which is the same posture as
  // authentication — nothing configured means no, not everything.
  //
  // Never `*`. This API is authenticated, and a wildcard origin on an authenticated API is what
  // lets any page a user happens to visit act as them. `credentials` is on because a real session
  // will be an httpOnly cookie the browser sends by itself, and a wildcard is not even legal
  // alongside it.
  const { webOrigin } = load(parserSchema);
  if (webOrigin === '') {
    // **Say it out loud.** Deny-by-default is right, but a silent denial presents to whoever is
    // running the stack as "Could not reach the server" in the browser — a message pointing at the
    // network when the cause is one unset variable. That is the same class of failure this codebase
    // rejects everywhere else: a configuration problem wearing the costume of an outage.
    new Logger('Bootstrap').warn(
      'ZENTAVIO_WEB_ORIGIN is not set, so no CORS headers are sent and every browser request will ' +
        'be blocked. The API still works for server-to-server callers. Set it to the web app origin ' +
        '(e.g. http://127.0.0.1:3000) to use apps/web.',
    );
  } else {
    app.enableCors({
      origin: webOrigin,
      credentials: true,
      methods: ['GET', 'POST', 'OPTIONS'],
      // The dev credential travels as a header, so a preflight fails without it named here. It
      // disappears with the header itself when a real session lands (ADR-0017).
      allowedHeaders: ['content-type', DEV_SUBJECT_HEADER],
    });
  }

  // So a rolling deploy drains in-flight uploads instead of dropping a résumé mid-parse.
  app.enableShutdownHooks();

  await app.listen(port);
}

// Only when executed directly, so importing this module in a test does not bind a port.
const executedDirectly = process.argv[1]?.endsWith('main.js') === true;
if (executedDirectly) {
  await bootstrap();
}
