import { Injectable } from '@nestjs/common';
import type {
  CreateDepartmentInput,
  Department,
  ListDepartmentsQuery,
  Paginated,
  UpdateDepartmentInput,
} from '@ims/shared';
import { ConflictError, NotFoundError } from '../../common/errors';
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
  constructor(private readonly repo: DepartmentsRepository) {}

  async list(query: ListDepartmentsQuery): Promise<Paginated<Department>> {
    const { items, total } = await this.repo.list(query);
    return { items, page: query.page, limit: query.limit, total };
  }

  async create(input: CreateDepartmentInput): Promise<Department> {
    try {
      const id = await this.repo.insert(input.name);
      const created = await this.repo.findById(id);
      if (!created) throw new NotFoundError('Department');
      return created;
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError('A department with that name exists');
      throw error;
    }
  }

  async update(id: string, input: UpdateDepartmentInput): Promise<Department> {
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
      await this.repo.update(id, { name: input.name, isActive: input.isActive });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError('A department with that name exists');
      throw error;
    }

    const updated = await this.repo.findById(id);
    if (!updated) throw new NotFoundError('Department');
    return updated;
  }
}
