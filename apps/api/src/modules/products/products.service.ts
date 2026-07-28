import { Injectable } from '@nestjs/common';
import type {
  CreateProductInput,
  ListProductsQuery,
  Paginated,
  Product,
  ProductDetail,
  UpdateProductInput,
} from '@ims/shared';
import { ConflictError, NotFoundError } from '../../common/errors';
import { isForeignKeyViolation, isUniqueViolation } from '../../common/pg-errors';
import { StockService } from '../stock/stock.service';
import { toPlacement } from '../stock/stock.mappers';
import { ProductsRepository } from './products.repository';

@Injectable()
export class ProductsService {
  constructor(
    private readonly repo: ProductsRepository,
    /** Placements are read through the service; no module outside it touches those tables. */
    private readonly stock: StockService,
  ) {}

  async list(query: ListProductsQuery): Promise<Paginated<Product>> {
    const { items, total } = await this.repo.list(query);
    return { items, page: query.page, limit: query.limit, total };
  }

  async findById(id: string): Promise<ProductDetail> {
    const product = await this.repo.findById(id);
    if (!product) throw new NotFoundError('Product');

    const placements = await this.stock.placementsForProduct(id);
    return { ...product, placements: placements.map(toPlacement) };
  }

  async create(input: CreateProductInput): Promise<ProductDetail> {
    try {
      const id = await this.repo.insert({
        productCode: input.productCode,
        name: input.name,
        categoryId: input.categoryId,
        unit: input.unit,
        defaultReturnable: input.defaultReturnable,
        description: input.description,
      });
      return await this.findById(id);
    } catch (error) {
      throw translate(error);
    }
  }

  /**
   * Soft delete via `isActive: false` (plan 1.2). There is no hard delete on purpose — a
   * product with ledger rows or placements must keep resolving, or every historical movement
   * loses its name. Deactivation only removes it from the default listing.
   */
  async update(id: string, input: UpdateProductInput): Promise<ProductDetail> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundError('Product');

    try {
      await this.repo.update(id, {
        productCode: input.productCode,
        name: input.name,
        categoryId: input.categoryId,
        unit: input.unit,
        defaultReturnable: input.defaultReturnable,
        description: input.description,
        isActive: input.isActive,
      });
    } catch (error) {
      throw translate(error);
    }

    return this.findById(id);
  }
}

function translate(error: unknown): unknown {
  // Unique index on lower(btrim(product_code)) — the Storage ID on the shelf label is the
  // physical identifier, so two rows sharing one is a stock-take that can never be resolved.
  if (isUniqueViolation(error)) {
    return new ConflictError('A product with that code already exists');
  }
  if (isForeignKeyViolation(error)) return new NotFoundError('Category');
  return error;
}
