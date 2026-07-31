import { Controller, Get, Inject } from '@nestjs/common';
import { sql } from 'kysely';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import { Role } from '@ims/shared';
import { Public, Roles } from '../auth/auth.decorators';
import {
  SystemHealthService,
  type SystemHealth,
} from '../maintenance/system-health.service';

/**
 * The compose healthcheck hits this. It touches the database on purpose: an API that is
 * listening but cannot reach Postgres is not healthy, and reporting it as healthy would let
 * a rolling deploy send traffic at it.
 */
@Controller()
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly systemHealthService: SystemHealthService,
  ) {}

  @Public()
  @Get('health')
  async health(): Promise<{ status: 'ok'; database: 'up' }> {
    await sql`SELECT 1`.execute(this.db);
    return { status: 'ok', database: 'up' };
  }

  /**
   * The detailed floor: disk headroom, whether uploads can actually be written, and how old the
   * newest backup is.
   *
   * Admin-only and deliberately **not** on the public `/health`. Free disk space and backup
   * timing tell an attacker when the host is under pressure and whether anyone is watching, and
   * the compose healthcheck has no use for either — it needs one bit, and it already has it.
   */
  @Roles(Role.ADMIN)
  @Get('admin/system-health')
  async systemHealth(): Promise<SystemHealth> {
    return this.systemHealthService.check();
  }
}
