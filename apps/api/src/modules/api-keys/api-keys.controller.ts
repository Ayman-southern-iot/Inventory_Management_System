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
  createServiceAccountSchema,
  listApiKeysQuerySchema,
  updateApiKeySchema,
  updateServiceAccountSchema,
  type ApiKey,
  type ApiKeyUsageDoc,
  type CreateApiKeyInput,
  type CreateServiceAccountInput,
  type CreatedApiKey,
  type ListApiKeysQuery,
  type Paginated,
  type ServiceAccount,
  type UpdateApiKeyInput,
  type UpdateServiceAccountInput,
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
 * is `@Roles(Role.ADMIN)` rather than per-route. An API key can never reach any of it, for two
 * independent reasons (ADR-0002): no route here carries `@ApiKeyScopes`, so the guard refuses a
 * key before `@Roles` is consulted; and the service account a bound key acts as holds only
 * GENERAL and INVENTORY_MANAGER, never ADMIN. A key cannot mint more keys.
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

  /* ---------------------------------------------------------------- service accounts */

  /**
   * The principals write-capable keys act as (ADR-0002). Listed here and nowhere else — the
   * Users screen shows people — so a key and the account it acts as are managed side by side.
   */
  @Get('service-accounts')
  async listServiceAccounts(): Promise<ServiceAccount[]> {
    return this.apiKeys.listServiceAccounts();
  }

  @Post('service-accounts')
  async createServiceAccount(
    @Body(zodPipe(createServiceAccountSchema)) body: CreateServiceAccountInput,
    @CurrentAuditContext() ctx: AuditContext,
  ): Promise<ServiceAccount> {
    return this.apiKeys.createServiceAccount(body, ctx);
  }

  /** Deactivating stops every key bound to the account at once; reactivating restores them. */
  @Patch('service-accounts/:id')
  async setServiceAccountActive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateServiceAccountSchema)) body: UpdateServiceAccountInput,
    @CurrentAuditContext() ctx: AuditContext,
  ): Promise<ServiceAccount> {
    return this.apiKeys.setServiceAccountActive(id, body.isActive, ctx);
  }
}
