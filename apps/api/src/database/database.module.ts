import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Pool } from 'pg';
import { CONFIG, type AppConfig } from '../config';
import { createDatabase, type Db } from './create-db';

export const DB = Symbol('KYSELY_DB');
const DB_POOL = Symbol('KYSELY_POOL');

@Global()
@Module({
  providers: [
    {
      provide: DB_POOL,
      inject: [CONFIG],
      useFactory: (config: AppConfig) => createDatabase(config),
    },
    {
      provide: DB,
      inject: [DB_POOL],
      useFactory: (created: { db: Db }) => created.db,
    },
  ],
  exports: [DB],
})
export class DatabaseModule implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseModule.name);

  constructor(@Inject(DB_POOL) private readonly created: { db: Db; pool: Pool }) {}

  /** Without this, `pnpm dev` leaks a pool per reload until Postgres refuses connections. */
  async onApplicationShutdown(): Promise<void> {
    await this.created.db.destroy();
    this.logger.log('Database pool closed');
  }
}
