import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type {
  CreateProjectInput,
  ListProjectItemsQuery,
  Paginated,
  PaginationQuery,
  Project,
  ProjectDetail,
  ProjectItem,
} from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import { NotFoundError } from '../../common/errors';
import { AuditService } from '../audit/audit.service';
import type { AuditContext } from '../audit/audit-context';
import { DuplicateProjectNameError } from '../borrowing/borrowing.errors';
import { ProjectsRepository } from './projects.repository';

/**
 * Projects are created on the fly during a borrow, so this is deliberately thin.
 *
 * OPEN QUESTION: OQ-09 — no code, owner or budget yet. Those would be additive columns, so
 * choosing the minimum now costs nothing later.
 */
@Injectable()
export class ProjectsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: ProjectsRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * A duplicate name is a *warning*, not a block (OQ-09): two teams may legitimately run a
   * "Falcon", so the user is told and may proceed deliberately. The comparison is
   * case-insensitive and trimmed, because "Falcon" and "falcon " are the same project to a
   * human and only differ to a database.
   */
  async create(
    input: CreateProjectInput,
    createdBy: string,
    context: AuditContext,
  ): Promise<Project> {
    if (!input.allowDuplicateName) {
      const existing = await this.findByNameInsensitive(input.name);
      if (existing) throw new DuplicateProjectNameError(existing.name);
    }

    // Audit row commits atomically with the insert: a project row cannot exist without its
    // audit entry, and vice versa.
    const row = await this.db.transaction().execute(async (tx) => {
      const inserted = await tx
        .insertInto('projects')
        .values({ name: input.name, created_by: createdBy })
        .returning(['id', 'name', 'is_active', 'created_at'])
        .executeTakeFirstOrThrow();
      await this.audit.record(
        {
          action: 'project.create',
          entityType: 'project',
          entityId: inserted.id,
          entityRef: input.name,
          summary: `Created project ${input.name}`,
          metadata: { name: input.name, allowDuplicateName: input.allowDuplicateName },
        },
        context,
        tx,
      );
      return inserted;
    });

    return {
      id: row.id,
      name: row.name,
      isActive: row.is_active,
      createdAt: row.created_at.toISOString(),
    };
  }

  /* ------------------------------------------------------------------ the hub */

  async listPaged(query: PaginationQuery): Promise<Paginated<Project>> {
    const { rows, total } = await this.repo.listProjects(query);
    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        isActive: row.is_active,
        createdAt: row.created_at.toISOString(),
      })),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  async detail(id: string): Promise<ProjectDetail> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundError('Project');
    const counts = await this.repo.countsByUsage(id);
    return {
      id: row.id,
      name: row.name,
      isActive: row.is_active,
      createdAt: row.created_at.toISOString(),
      inUseCount: counts.inUse,
      returnedCount: counts.returned,
    };
  }

  async items(id: string, query: ListProjectItemsQuery): Promise<Paginated<ProjectItem>> {
    const exists = await this.repo.findById(id);
    if (!exists) throw new NotFoundError('Project');
    const { items, total } = await this.repo.listItems(id, query);
    return { items, page: query.page, limit: query.limit, total };
  }

  /**
   * Detach, not delete. `borrow_requests` drives stock issue and return, so removing the row
   * would orphan `stock_ledger` and break SUM(ledger) == SUM(placements). Clearing the project
   * changes attribution only — no stock moved, so no ledger row is written.
   */
  async detachItem(
    projectId: string,
    borrowRequestId: string,
    context: AuditContext,
  ): Promise<void> {
    const project = await this.repo.findById(projectId);
    if (!project) throw new NotFoundError('Project');

    // One transaction, like `create`: an item cannot leave a project without the row that says
    // who removed it, and a failed audit write must take the detach with it.
    await this.db.transaction().execute(async (tx) => {
      const updated = await this.repo.detachItem(projectId, borrowRequestId, tx);
      if (updated === 0) throw new NotFoundError('Project item');

      await this.audit.record(
        {
          action: 'project.item.detach',
          entityType: 'project',
          entityId: projectId,
          entityRef: project.name,
          summary: `Removed a borrow from project ${project.name}`,
          metadata: { borrowRequestId },
        },
        context,
        tx,
      );
    });
  }

  private async findByNameInsensitive(name: string) {
    return this.db
      .selectFrom('projects')
      .select(['id', 'name'])
      .where(sql`lower(btrim(name))`, '=', name.trim().toLowerCase())
      .executeTakeFirst();
  }
}