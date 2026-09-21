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
import { ApiKeyScopes } from '../api-keys/api-key.decorators';
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
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<ProductDetail> {
    return this.products.findById(id);
  }

  @Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
  @Post()
  async create(
    @Body(zodPipe(createProductSchema)) body: CreateProductInput,
    @CurrentAuditContext() ctx: AuditContext,
  ): Promise<ProductDetail> {
    return this.products.create(body, ctx);
  }

  @Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateProductSchema)) body: UpdateProductInput,
    @CurrentAuditContext() ctx: AuditContext,
  ): Promise<ProductDetail> {
    return this.products.update(id, body, ctx);
  }
}
