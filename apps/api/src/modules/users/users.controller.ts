import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  Role,
  createUserSchema,
  listUsersQuerySchema,
  resetPasswordSchema,
  setUserActiveSchema,
  updateUserSchema,
  type CreateUserInput,
  type ListUsersQuery,
  type Paginated,
  type ResetPasswordInput,
  type SetUserActiveInput,
  type UpdateUserInput,
  type User,
} from '@ims/shared';
import { zodPipe } from '../../common/zod-validation.pipe';
import { AuthenticatedThrottle } from '../../common/throttling';
import { Roles } from '../auth/auth.decorators';
import { CurrentAuditContext } from '../audit/audit.decorators';
import type { AuditContext } from '../audit/audit-context';
import { UsersService } from './users.service';

/** Every route here is admin-only; a non-admin gets 403 before reaching the handler (plan 0.7). */
@AuthenticatedThrottle
@Roles(Role.ADMIN)
@Controller('admin/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  async list(
    @Query(zodPipe(listUsersQuerySchema)) query: ListUsersQuery,
  ): Promise<Paginated<User>> {
    return this.users.list(query);
  }

  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<User> {
    return this.users.findById(id);
  }

  @Post()
  async create(
    @Body(zodPipe(createUserSchema)) body: CreateUserInput,
    @CurrentAuditContext() ctx: AuditContext,
  ): Promise<User> {
    return this.users.create(body, ctx);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateUserSchema)) body: UpdateUserInput,
    @CurrentAuditContext() ctx: AuditContext,
  ): Promise<User> {
    return this.users.update(id, body, ctx);
  }

  /**
   * Deactivation rather than deletion: a user who approved a requisition in March must still
   * resolve on that requisition's audit trail.
   */
  @Patch(':id/active')
  async setActive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(setUserActiveSchema)) body: SetUserActiveInput,
    @CurrentAuditContext() ctx: AuditContext,
  ): Promise<User> {
    return this.users.setActive(id, body.isActive, ctx);
  }

  @Post(':id/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(resetPasswordSchema)) body: ResetPasswordInput,
    @CurrentAuditContext() ctx: AuditContext,
  ): Promise<void> {
    await this.users.resetPassword(id, body, ctx);
  }
}
