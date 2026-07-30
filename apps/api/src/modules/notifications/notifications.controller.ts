import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import {
  listNotificationsQuerySchema,
  markNotificationsReadSchema,
  type ListNotificationsQuery,
  type MarkNotificationsReadInput,
  type Notification,
  type Paginated,
  type UnreadCount,
} from '@ims/shared';
import { zodPipe } from '../../common/zod-validation.pipe';
import { CurrentUser } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/request-user';
import { NotificationsService } from './notifications.service';

/**
 * Every route here is implicitly scoped to the caller. There is no `userId` parameter anywhere
 * and there must never be one — the actor comes from `@CurrentUser()`, so one user cannot read
 * or clear another's queue. That is the whole authorization model for this module, which is why
 * it carries no `@Roles`: every authenticated user has notifications.
 */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  async list(
    @CurrentUser() actor: RequestUser,
    @Query(zodPipe(listNotificationsQuerySchema)) query: ListNotificationsQuery,
  ): Promise<Paginated<Notification>> {
    return this.notifications.list(actor.id, query);
  }

  /**
   * The badge. Polled by every signed-in client, so it stays a single indexed count and returns
   * nothing else — adding a field here multiplies across every poll of every session.
   */
  @Get('unread-count')
  async unreadCount(@CurrentUser() actor: RequestUser): Promise<UnreadCount> {
    return { unread: await this.notifications.unreadCount(actor.id) };
  }

  @Post('mark-read')
  @HttpCode(HttpStatus.OK)
  async markRead(
    @CurrentUser() actor: RequestUser,
    @Body(zodPipe(markNotificationsReadSchema)) body: MarkNotificationsReadInput,
  ): Promise<UnreadCount> {
    await this.notifications.markRead(actor.id, body.ids);
    return { unread: await this.notifications.unreadCount(actor.id) };
  }

  @Post('mark-all-read')
  @HttpCode(HttpStatus.OK)
  async markAllRead(@CurrentUser() actor: RequestUser): Promise<UnreadCount> {
    await this.notifications.markAllRead(actor.id);
    return { unread: 0 };
  }
}
