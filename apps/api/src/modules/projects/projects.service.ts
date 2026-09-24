import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { ProjectStatus, Role } from '@ims/shared';
import type {
  CreateProjectInput,
  DecideProjectInput,
  ListProjectItemsQuery,
  ListProjectsQuery,
  Paginated,
  Project,
  ProjectDetail,
  ProjectItem,
} from '@ims/shared';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import { ConflictError, NotFoundError } from '../../common/errors';
import { AuditService } from '../audit/audit.service';
import type { AuditContext } from '../audit/audit-context';
import { DuplicateProjectNameError } from '../borrowing/borrowing.errors';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_LINKS } from '../notifications/notifications.links';
import { ProjectsRepository } from './projects.repository';

/** One shape for the wire, so list, detail and decide cannot drift apart. */
function toProject(row: {
  id: string;
  name: string;
  is_active: boolean;
  status: ProjectStatus;
  decided_at: Date | null;
  decision_note: string | null;
  created_at: Date;
  created_by_name: string | null;
  decided_by_name: string | null;
}): Project {
  return {
    id: row.id,
    name: row.name,
    isActive: row.is_active,
    status: row.status,
    decidedAt: row.decided_at?.toISOString() ?? null,
    decidedByName: row.decided_by_name,
    decisionNote: row.decision_note,
    createdAt: row.created_at.toISOString(),
    createdByName: row.created_by_name,
  };
}

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
    private readonly notifications: NotificationsService,
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
        .returning(['id', 'name', 'is_active', 'status', 'created_at'])
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
      // The IMs are the only people who can turn a proposal into a usable project.
      await this.notifications.notify(
        {
          type: 'project.proposed',
          userIds: await this.notifications.usersWithRole(Role.INVENTORY_MANAGER, tx),
          ref: input.name,
          link: NOTIFICATION_LINKS.projects,
          entityType: 'project',
          entityId: inserted.id,
          actorId: createdBy,
          actorName: context.actorName,
        },
        tx,
      );
      return inserted;
    });

    return {
      id: row.id,
      name: row.name,
      isActive: row.is_active,
      status: row.status,
      decidedAt: null,
      decidedByName: null,
      decisionNote: null,
      createdAt: row.created_at.toISOString(),
      createdByName: context.actorName,
    };
  }

  /**
   * The IM's verdict on a proposal.
   *
   * A rejection does NOT detach the borrows or requisitions already charged to the project.
   * Attribution is history: a borrow was raised against this project and clearing that would
   * falsify the record of where the item went, for the sake of tidying a list. The project
   * simply stops being offered — `listProjects` filters the pickers to ACTIVE.
   *
   * OPEN QUESTION: OQ-C — whether a rejected project holding outstanding items should instead
   * be refused until they are moved. Rejecting-and-leaving is the smaller default; forcing the
   * IM to reassign somebody else's borrow before they can decline a proposal is the bigger
   * behaviour and nobody has asked for it.
   */
  async decide(
    id: string,
    input: DecideProjectInput,
    actorId: string,
    context: AuditContext,
  ): Promise<Project> {
    const project = await this.repo.findById(id);
    if (!project) throw new NotFoundError('Project');
    if (project.status !== ProjectStatus.PROPOSED) {
      throw new ConflictError('That project has already been decided.');
    }

    const status = input.approve ? ProjectStatus.ACTIVE : ProjectStatus.REJECTED;
    const note = input.note?.trim() ? input.note.trim() : null;

    await this.db.transaction().execute(async (tx) => {
      const updated = await this.repo.decide(id, status, actorId, note, tx);
      // Zero rows means another IM decided it between the read above and this write.
      if (updated === 0) throw new ConflictError('That project has already been decided.');

      await this.audit.record(
        {
          action: 'project.decide',
          entityType: 'project',
          entityId: id,
          entityRef: project.name,
          summary: `${input.approve ? 'Accepted' : 'Rejected'} project ${project.name}`,
          metadata: { status, note },
        },
        context,
        tx,
      );

      // `notify` drops the actor, so an IM deciding their own proposal is not told about it.
      if (project.created_by) {
        await this.notifications.notify(
          {
            type: input.approve ? 'project.approved' : 'project.rejected',
            userIds: [project.created_by],
            ref: project.name,
            link: NOTIFICATION_LINKS.project(id),
            entityType: 'project',
            entityId: id,
            actorId,
            actorName: context.actorName,
            context: { note },
          },
          tx,
        );
      }
    });

    const decided = await this.repo.findById(id);
    if (!decided) throw new NotFoundError('Project');
    return toProject(decided);
  }

  /* ------------------------------------------------------------------ the hub */

  async listPaged(query: ListProjectsQuery): Promise<Paginated<Project>> {
    const { rows, total } = await this.repo.listProjects(query);
    return {
      items: rows.map(toProject),
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
      ...toProject(row),
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
