import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  ApiKeyScope,
  Role,
  createCategorySchema,
  updateCategorySchema,
  type Category,
  type CategoryNode,
  type CreateCategoryInput,
  type UpdateCategoryInput,
} from '@ims/shared';
import { zodPipe } from '../../common/zod-validation.pipe';
import { AuthenticatedThrottle } from '../../common/throttling';
import { Roles } from '../auth/auth.decorators';
import { ApiKeyScopes, CurrentApiKey } from '../api-keys/api-key.decorators';
import { refuseActivationChangeByKey } from '../api-keys/api-key.policies';
import { CurrentAuditContext } from '../audit/audit.decorators';
import type { AuditContext } from '../audit/audit-context';
import { CategoriesService } from './categories.service';

@AuthenticatedThrottle
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  /**
   * Readable by any authenticated user — "browse inventory" is everyone's (reference §10).
   * Unpaginated on purpose: the response is the whole tree, and a page of a tree is not a tree.
   * The table is bounded by how many categories a human will maintain.
   */
  @ApiKeyScopes({
    summary: 'The whole category tree, nested. Each node carries its own and its subtree counts.',
    scopes: [ApiKeyScope.INVENTORY_READ],
  })
  @Get()
  async tree(): Promise<CategoryNode[]> {
    return this.categories.tree();
  }

  @ApiKeyScopes({
    summary: 'Create a category, at the top of the tree or under an existing parent.',
    scopes: [ApiKeyScope.CATALOG_WRITE],
    body: createCategorySchema,
  })
  @Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
  @Post()
  async create(
    @Body(zodPipe(createCategorySchema)) body: CreateCategoryInput,
    @CurrentAuditContext() ctx: AuditContext,
  ): Promise<Category> {
    return this.categories.create(body, ctx);
  }

  @ApiKeyScopes({
    summary:
      'Rename or move a category. Send only the fields you are changing. A key cannot archive or re-activate one.',
    scopes: [ApiKeyScope.CATALOG_WRITE],
    body: updateCategorySchema,
  })
  @Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateCategorySchema)) body: UpdateCategoryInput,
    @CurrentAuditContext() ctx: AuditContext,
    @CurrentApiKey() apiKey: { id: string } | null,
  ): Promise<Category> {
    refuseActivationChangeByKey(apiKey, body.isActive);
    return this.categories.update(id, body, ctx);
  }
}
