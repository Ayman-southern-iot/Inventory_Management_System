import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { CreateProjectInput, Project } from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import { NotFoundError } from '../../common/errors';
import { AuditService } from '../audit/audit.service';
import type { AuditContext } from '../audit/audit-context';
import { DuplicateProjectNameError } from './borrowing.errors';

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
    private readonly audit: AuditService,
  ) {}

  async list(includeInactive = false): Promise<Project[]> {
    const rows = await this.db
      .selectFrom('projects')
      .select(['id', 'name', 'is_active', 'created_at'])
      .$if(!includeInactive, (qb) => qb.where('is_active', '=', true))
      .orderBy('name')
      .execute();

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      isActive: row.is_active,
      createdAt: row.created_at.toISOString(),
    }));
  }

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

  async setActive(
    id: string,
    isActive: boolean,
    context: AuditContext,
  ): Promise<Project> {
    const existing = await this.db
      .selectFrom('projects')
      .select(['id', 'name', 'is_active'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!existing) throw new NotFoundError('Project');

    // If status did not change, skip the mutation and the audit row — there's nothing to
    // record. This matches the diffSafeFields guard in departments/products updates.
    const result = await this.db.transaction().execute(async (tx) => {
      const updated = await tx
        .updateTable('projects')
        .set({ is_active: isActive })
        .where('id', '=', id)
        .returning(['id', 'name', 'is_active', 'created_at'])
        .executeTakeFirst();
      if (!updated) throw new NotFoundError('Project');
      // Only the columns the domain owns.
      if (existing.is_active !== isActive) {
        await this.audit.record(
          {
            action: 'project.update',
            entityType: 'project',
            entityId: id,
            entityRef: existing.name,
            summary: `${isActive ? 'Activated' : 'Deactivated'} project ${existing.name}`,
            metadata: {
              changes: {
                isActive: { before: existing.is_active, after: isActive },
              },
            },
          },
          context,
          tx,
        );
      }
      return updated;
    });

    return {
      id: result.id,
      name: result.name,
      isActive: result.is_active,
      createdAt: result.created_at.toISOString(),
    };
  }

  private async findByNameInsensitive(name: string) {
    return this.db
      .selectFrom('projects')
      .select(['id', 'name'])
      .where(sql`lower(btrim(name))`, '=', name.trim().toLowerCase())
      .executeTakeFirst();
  }
}