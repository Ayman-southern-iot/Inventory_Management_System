import { Controller, Get } from '@nestjs/common';
import type { PersonalRecord } from '@ims/shared';
import { AuthenticatedThrottle } from '../../common/throttling';
import { CurrentUser } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/request-user';
import { DashboardService } from './dashboard.service';

/**
 * The signed-in person's own record.
 *
 * **No `@Roles`, and no user id in the path or query.** Ayman's ruling, 2026-08-26: own figures
 * only. Everyone is entitled to their own record, and the actor comes from `req.user.id`, so
 * there is no parameter to tamper with and nothing to authorise beyond being signed in
 * (rules/20-backend.md: never trust a client-supplied user id).
 *
 * That is also why this is `/dashboard/me` rather than `/dashboard/:userId` with an ownership
 * check. A route that *could* name someone else is a route somebody will eventually widen; one
 * that cannot express the question needs no guard against it.
 */
@AuthenticatedThrottle
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('me')
  async me(@CurrentUser() actor: RequestUser): Promise<PersonalRecord> {
    return this.dashboard.personalRecord(actor.id);
  }
}
