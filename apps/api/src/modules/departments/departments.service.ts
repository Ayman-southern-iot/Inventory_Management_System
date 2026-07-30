import { Inject, Injectable } from '@nestjs/common';
import type {
  CreateDepartmentInput,
  Department,
  ListDepartmentsQuery,
  Paginated,
  UpdateDepartmentInput,
} from '@ims/shared';
import { ConflictError, NotFoundError } from '../../common/errors';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import { AuditService } from '../audit/audit.service';
import type { AuditContext } from '../audit/audit-context';
import { DepartmentsRepository } from './departments.repository';

const PG_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === PG_UNIQUE_VIOLATION
  );
}

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly repo: DepartmentsRepository,
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListDepartmentsQuery): Promise<Paginated<Department>> {
    const { items, total } = await this.repo.list(query);
    return { items, page: query.page, limit: query.limit, total };
  }

  async create(input: CreateDepartmentInput, context: AuditContext): Promise<Department> {
    try {
      const id = await this.db.transaction().execute(async (tx) => {
        const newId = await this.repo.insert(input.name, tx);
        await this.audit.record(
          {
            action: 'department.create',
            entityType: 'department',
            entityId: newId,
            entityRef: input.name,
            summary: `Created department ${input.name}`,
            metadata: { name: input.name },
          },
          context,
          tx,
        );
        return newId;
      });
      const created = await this.repo.findById(id);
      if (!created) throw new NotFoundError('Department');
      return created;
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError('A department with that name exists');
      throw error;
    }
  }

  async update(
    id: string,
    input: UpdateDepartmentInput,
    context: AuditContext,
  ): Promise<Department> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundError('Department');

    // Deactivating a department that still holds people would orphan them in every filter
    // and leave the BOM footprint block pointing at a department nobody can select.
    if (input.isActive === false) {
      const activeUsers = await this.repo.countActiveUsers(id);
      if (activeUsers > 0) {
        throw new ConflictError(
          `Move the ${activeUsers} active user(s) out of this department before deactivating it`,
        );
      }
    }

    try {
      await this.db.transaction().execute(async (tx) => {
        await this.repo.update(id, { name: input.name, isActive: input.isActive }, tx);
        const { diffSafeFields } = await import('../audit/audit-sanitizer');
        const changes = diffSafeFields(
          {
            name: existing.name,
            isActive: existing.isActive,
          } as Record<string, unknown>,
          {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          } as Record<string, unknown>,
          ['name', 'isActive'],
        );
        if (Object.keys(changes).length > 0) {
          await this.audit.record(
            {
              action: 'department.update',
              entityType: 'department',
              entityId: id,
              entityRef: existing.name,
              summary: `Updated department ${existing.name}`,
              metadata: { changes },
            },
            context,
            tx,
          );
        }
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError('A department with that name exists');
      throw error;
    }

    const updated = await this.repo.findById(id);
    if (!updated) throw new NotFoundError('Department');
    return updated;
  }
}
