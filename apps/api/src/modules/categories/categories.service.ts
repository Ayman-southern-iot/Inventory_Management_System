import { Inject, Injectable } from '@nestjs/common';
import type {
  Category,
  CategoryNode,
  CreateCategoryInput,
  UpdateCategoryInput,
} from '@ims/shared';
import { ConflictError, NotFoundError } from '../../common/errors';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import { isUniqueViolation } from '../../common/pg-errors';
import { AuditService } from '../audit/audit.service';
import type { AuditContext } from '../audit/audit-context';
import { diffSafeFields } from '../audit/audit-sanitizer';
import { CategoriesRepository } from './categories.repository';

@Injectable()
export class CategoriesService {
  constructor(
    private readonly repo: CategoriesRepository,
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /**
   * Deactivated categories stay in the response, carrying `isActive: false`.
   *
   * Filtering them out server-side would orphan any live child of a retired parent and silently
   * drop it from the tree; the caller decides what to render, and the product pickers filter on
   * the flag they are given.
   */
  async tree(): Promise<CategoryNode[]> {
    return buildTree(await this.repo.listAll());
  }

  async create(input: CreateCategoryInput, context: AuditContext): Promise<Category> {
    if (input.parentId !== null) {
      const parent = await this.repo.findById(input.parentId);
      if (!parent) throw new NotFoundError('Parent category');
    }

    try {
      const id = await this.db.transaction().execute(async (tx) => {
        const newId = await this.repo.insert(
          {
            name: input.name,
            parentId: input.parentId,
            isTrackable: input.isTrackable,
          },
          tx,
        );
        // Audit inside the transaction: a successful category create cannot lack its audit
        // row, and the redactor keeps the metadata free of anything sensitive.
        await this.audit.record(
          {
            action: 'category.create',
            entityType: 'category',
            entityId: newId,
            entityRef: input.name,
            summary: `Created category ${input.name}`,
            metadata: {
              name: input.name,
              parentId: input.parentId,
              isTrackable: input.isTrackable,
            },
          },
          context,
          tx,
        );
        return newId;
      });
      return await this.require(id);
    } catch (error) {
      if (isUniqueViolation(error)) throw duplicateName();
      throw error;
    }
  }

  /**
   * `is_trackable` is an ordinary updatable field — requirements §11 wants furniture switched on
   * from the category screen, never from a deploy. `parentId` is deliberately absent from
   * `updateCategorySchema`, so re-parenting cannot introduce a cycle here.
   */
  async update(
    id: string,
    input: UpdateCategoryInput,
    context: AuditContext,
  ): Promise<Category> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundError('Category');

    // Soft delete only. Retiring a category that still holds live products or subcategories
    // would hide them from every picker while leaving them selectable in older screens.
    if (input.isActive === false && existing.isActive) {
      const [products, children] = await Promise.all([
        this.repo.countActiveProducts(id),
        this.repo.countActiveChildren(id),
      ]);
      if (products > 0) {
        throw new ConflictError(
          `Move or deactivate the ${products} active product(s) in this category first`,
        );
      }
      if (children > 0) {
        throw new ConflictError(
          `Deactivate the ${children} active subcategory/subcategories first`,
        );
      }
    }

    try {
      await this.db.transaction().execute(async (tx) => {
        await this.repo.update(
          id,
          {
            name: input.name,
            isTrackable: input.isTrackable,
            isActive: input.isActive,
          },
          tx,
        );
        const changes = diffSafeFields(
          {
            name: existing.name,
            isTrackable: existing.isTrackable,
            isActive: existing.isActive,
          },
          {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.isTrackable !== undefined ? { isTrackable: input.isTrackable } : {}),
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          },
          ['name', 'isTrackable', 'isActive'],
        );
        if (Object.keys(changes).length > 0) {
          await this.audit.record(
            {
              action: 'category.update',
              entityType: 'category',
              entityId: id,
              entityRef: existing.name,
              summary: `Updated category ${existing.name}`,
              metadata: { changes },
            },
            context,
            tx,
          );
        }
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw duplicateName();
      throw error;
    }

    return this.require(id);
  }

  private async require(id: string): Promise<Category> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundError('Category');
    return row;
  }
}

function duplicateName(): ConflictError {
  return new ConflictError('A category with that name already exists under the same parent');
}

/**
 * One pass to index, one to link. A row whose parent is missing is surfaced as a root rather
 * than dropped — an invisible category is worse than a misplaced one.
 */
export function buildTree(categories: readonly Category[]): CategoryNode[] {
  const nodes = new Map<string, CategoryNode>();
  for (const category of categories) nodes.set(category.id, { ...category, children: [] });

  const roots: CategoryNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId === null ? undefined : nodes.get(node.parentId);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}
