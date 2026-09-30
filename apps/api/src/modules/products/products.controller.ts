import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  ApiKeyScope,
  Role,
  createProductSchema,
  listProductsQuerySchema,
  updateProductSchema,
  type CreateProductInput,
  type ListProductsQuery,
  type Paginated,
  type Product,
  type ProductDetail,
  type UpdateProductInput,
} from '@ims/shared';
import { zodPipe } from '../../common/zod-validation.pipe';
import { AuthenticatedThrottle } from '../../common/throttling';
import { Roles } from '../auth/auth.decorators';
import { ApiKeyScopes, CurrentApiKey } from '../api-keys/api-key.decorators';
import { refuseActivationChangeByKey } from '../api-keys/api-key.policies';
import { CurrentAuditContext } from '../audit/audit.decorators';
import type { AuditContext } from '../audit/audit-context';
import { ProductsService } from './products.service';

@AuthenticatedThrottle
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  /** Browsing inventory is everyone's (reference §10); mutation is the IM's. */
  @ApiKeyScopes({
    summary:
      'Every product, paginated, with stock totals. Filter with search, categoryId or inStockOnly.',
    scopes: [ApiKeyScope.INVENTORY_READ],
    query: listProductsQuerySchema,
  })
  @Get()
  async list(
    @Query(zodPipe(listProductsQuerySchema)) query: ListProductsQuery,
  ): Promise<Paginated<Product>> {
    return this.products.list(query);
  }

  @ApiKeyScopes({
    summary: 'One product, including which shelf each unit is on and what is currently on loan.',
    scopes: [ApiKeyScope.INVENTORY_READ],
  })
  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentApiKey() apiKey: { id: string } | null,
  ): Promise<ProductDetail> {
    const detail = await this.products.findById(id);
    /*
     * K2: borrowing names employees and stays out of key reach (reaffirmed 2026-09-29 as
     * OQ-KT6). The loan list carries each borrower's name, so a key gets none of it — how much
     * is out still shows in the placements' reserved and available figures. Found by the
     * ADR-0002 security review; key-readable since Phase 10.
     */
    return apiKey ? { ...detail, activeBorrows: [] } : detail;
  }

  @ApiKeyScopes({
    summary: 'Create a product in the catalogue. It holds no stock until something is received.',
    scopes: [ApiKeyScope.CATALOG_WRITE],
    body: createProductSchema,
  })
  @Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
  @Post()
  async create(
    @Body(zodPipe(createProductSchema)) body: CreateProductInput,
    @CurrentAuditContext() ctx: AuditContext,
  ): Promise<ProductDetail> {
    return this.products.create(body, ctx);
  }

  @ApiKeyScopes({
    summary:
      'Edit a product. Send only the fields you are changing; stock is not touched. A key cannot archive or re-activate one.',
    scopes: [ApiKeyScope.CATALOG_WRITE],
    body: updateProductSchema,
  })
  @Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateProductSchema)) body: UpdateProductInput,
    @CurrentAuditContext() ctx: AuditContext,
    @CurrentApiKey() apiKey: { id: string } | null,
  ): Promise<ProductDetail> {
    refuseActivationChangeByKey(apiKey, body.isActive);
    return this.products.update(id, body, ctx);
  }
}
