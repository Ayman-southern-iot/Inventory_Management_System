import { Inject, Injectable } from '@nestjs/common';
import type {
  CreateProductInput,
  ListProductsQuery,
  Paginated,
  Product,
  ProductDetail,
  UpdateProductInput,
} from '@ims/shared';
import { ConflictError, NotFoundError } from '../../common/errors';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import { isForeignKeyViolation, isUniqueViolation } from '../../common/pg-errors';
import { AuditService } from '../audit/audit.service';
import type { AuditContext } from '../audit/audit-context';
import { diffSafeFields } from '../audit/audit-sanitizer';
import { StockService } from '../stock/stock.service';
import { toPlacement } from '../stock/stock.mappers';
import { ProductsRepository, type Tx } from './products.repository';

@Injectable()
export class ProductsService {
  constructor(
    private readonly repo: ProductsRepository,
    /** Placements are read through the service; no module outside it touches those tables. */
    private readonly stock: StockService,
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
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

  /**
   * Create a product inside a transaction the caller already holds.
   *
   * Exists for task 5.6: a requisition line typed as free text ("2m USB-C cable") becomes a real
   * catalogue product the moment it is received into stock, and that has to commit together with
   * the stock movement and the requisition's status. Returning the id rather than the detail
   * keeps it usable mid-transaction, where a read-back would see uncommitted rows.
   *
   * Deliberately not a second code path: `create` below is this plus its own transaction and a
   * read-back, so the audit row and the insert stay identical for both callers.
   */
  async createWithin(
    tx: Tx,
    input: CreateProductInput,
    context: AuditContext,
  ): Promise<string> {
    try {
      return await this.insertAndAudit(tx, input, context);
    } catch (error) {
      throw translate(error);
    }
  }

  async create(input: CreateProductInput, context: AuditContext): Promise<ProductDetail> {
    try {
      const id = await this.db.transaction().execute(async (tx) =>
        this.insertAndAudit(tx, input, context),
      );
      return await this.findById(id);
    } catch (error) {
      throw translate(error);
    }
  }

  private async insertAndAudit(
    tx: Tx,
    input: CreateProductInput,
    context: AuditContext,
  ): Promise<string> {
    {
      {
        const newId = await this.repo.insert(
          {
            productCode: input.productCode,
            name: input.name,
            categoryId: input.categoryId,
            unit: input.unit,
            defaultReturnable: input.defaultReturnable,
            description: input.description,
          },
          tx,
        );
        // Audit inside the transaction: a successful product create cannot lack its audit
        // row, and the redactor guarantees no sensitive field sneaks into the metadata column.
        await this.audit.record(
          {
            action: 'product.create',
            entityType: 'product',
            entityId: newId,
            entityRef: input.productCode,
            summary: `Created product ${input.productCode}`,
            metadata: {
              productCode: input.productCode,
              name: input.name,
              categoryId: input.categoryId,
              unit: input.unit,
              defaultReturnable: input.defaultReturnable,
              description: input.description,
            },
          },
          { ...context, actorName: context.actorName ?? input.name },
          tx,
        );
        return newId;
      }
    }
  }

  /**
   * Soft delete via `isActive: false` (plan 1.2). There is no hard delete on purpose — a
   * product with ledger rows or placements must keep resolving, or every historical movement
   * loses its name. Deactivation only removes it from the default listing.
   */
  async update(
    id: string,
    input: UpdateProductInput,
    context: AuditContext,
  ): Promise<ProductDetail> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundError('Product');

    try {
      await this.db.transaction().execute(async (tx) => {
        await this.repo.update(
          id,
          {
            productCode: input.productCode,
            name: input.name,
            categoryId: input.categoryId,
            unit: input.unit,
            defaultReturnable: input.defaultReturnable,
            description: input.description,
            isActive: input.isActive,
          },
          tx,
        );
        // Only the columns the domain owns. A category move is a structural event, but it is
        // still an attribute of the product row, and surfacing the diff in the audit log is
        // what lets an admin reconstruct "why does this product sit in furniture now?".
        const changes = diffSafeFields(
          {
            productCode: existing.productCode,
            name: existing.name,
            categoryId: existing.categoryId,
            unit: existing.unit,
            defaultReturnable: existing.defaultReturnable,
            description: existing.description,
            isActive: existing.isActive,
          },
          {
            ...(input.productCode !== undefined ? { productCode: input.productCode } : {}),
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
            ...(input.unit !== undefined ? { unit: input.unit } : {}),
            ...(input.defaultReturnable !== undefined
              ? { defaultReturnable: input.defaultReturnable }
              : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          },
          [
            'productCode',
            'name',
            'categoryId',
            'unit',
            'defaultReturnable',
            'description',
            'isActive',
          ],
        );
        if (Object.keys(changes).length > 0) {
          await this.audit.record(
            {
              action: 'product.update',
              entityType: 'product',
              entityId: id,
              entityRef: existing.productCode,
              summary: `Updated product ${existing.productCode}`,
              metadata: { changes },
            },
            { ...context, actorName: context.actorName ?? existing.name },
            tx,
          );
        }
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
