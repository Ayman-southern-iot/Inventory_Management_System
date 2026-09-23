import { Inject, Injectable } from '@nestjs/common';
import { PAGINATION_MAX_LIMIT } from '@ims/shared';
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
import { generateProductCode } from './product-code';
import type { AuditContext } from '../audit/audit-context';
import { diffSafeFields } from '../audit/audit-sanitizer';
import { StockService } from '../stock/stock.service';
import { toPlacement } from '../stock/stock.mappers';
import { BorrowingRepository } from '../borrowing/borrowing.repository';
import { ProductsRepository, type Tx } from './products.repository';

@Injectable()
export class ProductsService {
  constructor(
    private readonly repo: ProductsRepository,
    /** Placements are read through the service; no module outside it touches those tables. */
    private readonly stock: StockService,
    /** Active borrows for the "Currently in use" section — read-only access. */
    private readonly borrowing: BorrowingRepository,
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListProductsQuery): Promise<Paginated<Product>> {
    const { items, total } = await this.repo.list(query);
    return { items, page: query.page, limit: query.limit, total };
  }

  /**
   * Every product, for the callers that genuinely need all of them at once — the catalogue
   * endpoint and the round-trip export.
   *
   * It walks the same paginated query everything else uses rather than adding an unbounded one,
   * so there is one definition of what a product row contains and what "active" means. The page
   * size is the ordinary ceiling, making this a handful of round trips rather than one enormous
   * query.
   *
   * `max` is a hard stop, not a truncation: a caller that silently received 5,000 of 5,200
   * products has no way to know its answer is incomplete, and would go on telling people the
   * missing ones do not exist. Past the ceiling it throws and the caller reports why.
   */
  async listAll(options: { includeInactive: boolean; max: number }): Promise<Product[]> {
    const collected: Product[] = [];

    for (let page = 1; ; page += 1) {
      const result = await this.repo.list({
        page,
        limit: PAGINATION_MAX_LIMIT,
        includeInactive: options.includeInactive,
        uncategorized: false,
        inStockOnly: false,
      });

      if (result.total > options.max) {
        throw new ConflictError(
          `The catalogue holds ${result.total} products, above the ${options.max} this endpoint will serve in one response.`,
        );
      }

      collected.push(...result.items);
      if (collected.length >= result.total || result.items.length === 0) break;
    }

    return collected;
  }

  /** Delegates to the repository's trigram query; see it for why this is one query. */
  async findSimilarNames(
    candidates: string[],
    threshold: number,
  ): Promise<{ candidate: string; id: string; name: string; score: number }[]> {
    return this.repo.findSimilarNames(candidates, threshold);
  }

  async findById(id: string): Promise<ProductDetail> {
    const product = await this.repo.findById(id);
    if (!product) throw new NotFoundError('Product');

    // Two reads, not one: a LEFT JOIN would inflate every product row with N borrow rows
    // and require a window-function trick to recover the original product shape. At 12 users
    // and borrowing volume in the dozens, two indexed reads are simpler and equally cheap.
    const [placements, activeBorrows] = await Promise.all([
      this.stock.placementsForProduct(id),
      this.borrowing.listActiveForProduct(id),
    ]);
    return {
      ...product,
      placements: placements.map(toPlacement),
      activeBorrows: activeBorrows.map((b) => ({
        borrowId: b.borrowId,
        borrowNo: b.borrowNo,
        borrowerId: b.borrowerId,
        borrowerName: b.borrowerName,
        projectId: b.projectId,
        projectName: b.projectName,
        quantity: b.quantity,
        returnedQty: b.returnedQty,
        outstandingQty: b.outstandingQty,
        expectedReturnDate: b.expectedReturnDate
          ? typeof b.expectedReturnDate === 'string'
            ? b.expectedReturnDate
            : b.expectedReturnDate.toISOString().slice(0, 10)
          : null,
        issuedAt: b.issuedAt ? b.issuedAt.toISOString() : null,
        isOverdue: b.isOverdue,
        lastReturnCondition: b.lastReturnCondition,
      })),
    };
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
  async createWithin(tx: Tx, input: CreateProductInput, context: AuditContext): Promise<string> {
    try {
      return await this.insertAndAudit(tx, input, context);
    } catch (error) {
      throw translate(error);
    }
  }

  /**
   * The import's write path: the same repository call, **without a per-product audit row**.
   *
   * I10. One human action produces one `import.apply` audit row naming the job, and the job
   * names who confirmed it; the ledger carries every stock movement. A row per created product
   * on top of that would swamp the log for the same information, and at five thousand rows it
   * is a third of the runtime.
   */
  async createForImport(tx: Tx, input: CreateProductInput): Promise<string> {
    try {
      const productCode = input.productCode ?? (await generateProductCode(tx, input.name));
      return await this.repo.insert(
        {
          productCode,
          name: input.name,
          categoryId: input.categoryId,
          unit: input.unit,
          defaultReturnable: input.defaultReturnable,
          description: input.description,
        },
        tx,
      );
    } catch (error) {
      throw translate(error);
    }
  }

  /** As `createForImport`, for a product that already exists. No audit row, same reason. */
  async updateForImport(tx: Tx, id: string, input: UpdateProductInput): Promise<void> {
    try {
      await this.repo.update(id, input, tx);
    } catch (error) {
      throw translate(error);
    }
  }

  async create(input: CreateProductInput, context: AuditContext): Promise<ProductDetail> {
    try {
      const id = await this.db
        .transaction()
        .execute(async (tx) => this.insertAndAudit(tx, input, context));
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
        // Generated unless the caller supplied one. Nothing in the UI supplies one any more —
        // ask #1 — but the requisition-line promotion path may carry a code the buyer already
        // used on an invoice, and overwriting that would lose the only link back to the paper.
        const productCode = input.productCode ?? (await generateProductCode(tx, input.name));

        const newId = await this.repo.insert(
          {
            productCode,
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
            entityRef: productCode,
            summary: `Created product ${productCode}`,
            metadata: {
              productCode: productCode,
              name: input.name,
              categoryId: input.categoryId,
              unit: input.unit,
              defaultReturnable: input.defaultReturnable,
              description: input.description,
            },
          },
          context,
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
            context,
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
