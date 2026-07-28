import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { config } from './config';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

  app.setGlobalPrefix(config.http.globalPrefix, { exclude: ['health'] });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.use(helmet());

  // Behind Caddy the SPA is same-origin and this list is empty; in dev it is the Vite origin.
  if (config.http.corsOrigins.length > 0) {
    app.enableCors({ origin: [...config.http.corsOrigins], credentials: true });
  }

  // Caddy sets X-Forwarded-For; without this every login attempt looks like it came from the
  // proxy and the per-IP rate limit would throttle the entire company at once.
  app.set('trust proxy', 1);

  app.enableShutdownHooks();

  await app.listen(config.http.port, '0.0.0.0');
  new Logger('Bootstrap').log(
    `API listening on :${config.http.port}/${config.http.globalPrefix} [${config.nodeEnv}]`,
  );
}

bootstrap().catch((error: unknown) => {
  // Config validation throws before Nest exists, so this is the only place that can report it.
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
