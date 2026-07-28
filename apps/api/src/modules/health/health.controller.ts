import { Controller, Get, Inject } from '@nestjs/common';
import { sql } from 'kysely';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import { Public } from '../auth/auth.decorators';

/**
 * The compose healthcheck hits this. It touches the database on purpose: an API that is
 * listening but cannot reach Postgres is not healthy, and reporting it as healthy would let
 * a rolling deploy send traffic at it.
 */
@Controller()
export class HealthController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Public()
  @Get('health')
  async health(): Promise<{ status: 'ok'; database: 'up' }> {
    await sql`SELECT 1`.execute(this.db);
    return { status: 'ok', database: 'up' };
  }
}
