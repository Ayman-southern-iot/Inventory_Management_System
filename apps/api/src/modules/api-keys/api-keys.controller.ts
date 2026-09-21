import {
  Body,
  Controller,
  Delete,
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
  createApiKeySchema,
  listApiKeysQuerySchema,
  updateApiKeySchema,
  type ApiKey,
  type ApiKeyUsageDoc,
  type CreateApiKeyInput,
  type CreatedApiKey,
  type ListApiKeysQuery,
  type Paginated,
  type UpdateApiKeyInput,
} from '@ims/shared';
import { zodPipe } from '../../common/zod-validation.pipe';
import { AuthenticatedThrottle } from '../../common/throttling';
import { Roles } from '../auth/auth.decorators';
import { CurrentAuditContext } from '../audit/audit.decorators';
import type { AuditContext } from '../audit/audit-context';
import { ApiKeyDocsService } from './api-key-docs.service';
import { ApiKeysService } from './api-keys.service';

/**
 * Issuing credentials is an administrator's job and nobody else's (K9), so the whole controller
 * is `@Roles(Role.ADMIN)` rather than per-route. An API key can never reach any of it: `@Roles`
 * needs `request.user`, which a key deliberately does not set — a key cannot mint more keys.
 */
@AuthenticatedThrottle
@Roles(Role.ADMIN)
@Controller('admin/api-keys')
export class ApiKeysController {
  constructor(
    private readonly apiKeys: ApiKeysService,
    private readonly docs: ApiKeyDocsService,
  ) {}

  @Get()
  async list(
    @Query(zodPipe(listApiKeysQuerySchema)) query: ListApiKeysQuery,
  ): Promise<Paginated<ApiKey>> {
    return this.apiKeys.list(query);
  }

  /**
   * Generated from the live route table, not written by hand. Static for a given build, so it
   * sits under a fixed path rather than being computed per key — every key with the same scopes
   * gets the same instructions, and the page filters by scope client-side.
   */
  @Get('usage')
  usage(): ApiKeyUsageDoc {
    return this.docs.build();
  }

  /**
   * The only response that ever carries the raw key. It is not stored, so this is the one and
   * only chance to read it — the UI says so before the panel can be dismissed.
   */
  @Post()
  async create(
    @Body(zodPipe(createApiKeySchema)) body: CreateApiKeyInput,
    @CurrentAuditContext() ctx: AuditContext,
  ): Promise<CreatedApiKey> {
    return this.apiKeys.create(body, ctx);
  }

  @Patch(':id')
  async setActive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateApiKeySchema)) body: UpdateApiKeyInput,
    @CurrentAuditContext() ctx: AuditContext,
  ): Promise<ApiKey> {
    return this.apiKeys.setActive(id, body.isActive, ctx);
  }

  /** Revoke. Permanent, and the row stays so the audit trail still points at something. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuditContext() ctx: AuditContext,
  ): Promise<void> {
    return this.apiKeys.revoke(id, ctx);
  }
}
