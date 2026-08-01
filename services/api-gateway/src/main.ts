/**
 * Bootstrap only: app factory, pipes, filters, shutdown hooks
 * (`.claude/skills/backend-service/SKILL.md`). No routing, no logic.
 *
 * **This service is compiled, not type-stripped** (ADR-0014's 2026-08-01 amendment). NestJS needs
 * decorators and Node's strip-only mode cannot run them, so `services/*` build to `dist/` while
 * scripts and CLIs keep running directly. Run `pnpm --filter @zentavio/api-gateway build` first.
 */

import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
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

  // So a rolling deploy drains in-flight uploads instead of dropping a résumé mid-parse.
  app.enableShutdownHooks();

  await app.listen(port);
}

// Only when executed directly, so importing this module in a test does not bind a port.
const executedDirectly = process.argv[1]?.endsWith('main.js') === true;
if (executedDirectly) {
  await bootstrap();
}
