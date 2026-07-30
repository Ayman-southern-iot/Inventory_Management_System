import { Injectable, Logger } from '@nestjs/common';
import {
  Role,
  type CreateUserInput,
  type ListUsersQuery,
  type Paginated,
  type ResetPasswordInput,
  type UpdateUserInput,
  type User,
} from '@ims/shared';
import { ConflictError, ForbiddenError, NotFoundError } from '../../common/errors';
import { RefreshRevocationReason } from '../../database/schema';
import { PasswordService } from '../../security/password.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_LINKS } from '../notifications/notifications.links';
import type { AuditContext } from '../audit/audit-context';
import { UsersRepository, toUser, type Tx, type UserWithRoles } from './users.repository';

/** Postgres unique-violation. Catching it is how a duplicate email stays a single round trip. */
const PG_UNIQUE_VIOLATION = '23505';
/** Foreign-key violation — a department id that does not exist. */
const PG_FOREIGN_KEY_VIOLATION = '23503';

function isPgError(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === code;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly repo: UsersRepository,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async findById(id: string): Promise<User> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundError('User');
    return toUser(row);
  }

  /** Auth needs the hash and active flag, which never leave the backend. */
  async findAuthRecordByEmail(email: string): Promise<UserWithRoles | undefined> {
    return this.repo.findByEmail(email);
  }

  async findAuthRecordById(id: string): Promise<UserWithRoles | undefined> {
    return this.repo.findById(id);
  }

  async list(query: ListUsersQuery): Promise<Paginated<User>> {
    const { items, total } = await this.repo.list(query);
    return { items: items.map(toUser), page: query.page, limit: query.limit, total };
  }

  async create(input: CreateUserInput, context: AuditContext): Promise<User> {
    const passwordHash = await this.passwords.hash(input.password);

    try {
      const id = await this.repo.connection.transaction().execute(async (tx) => {
        const userId = await this.repo.insert(tx, {
          email: input.email,
          passwordHash,
          fullName: input.fullName,
          designation: input.designation,
          departmentId: input.departmentId,
          mustChangePassword: input.mustChangePassword,
        });
        await this.repo.replaceRoles(tx, userId, input.roles);
        // Audit inside the transaction: a successful user creation cannot lack its audit row,
        // and the redactor guarantees the password hash never reaches the metadata column.
        await this.audit.record(
          {
            action: 'user.create',
            entityType: 'user',
            entityId: userId,
            entityRef: input.email,
            summary: `Created user ${input.email}`,
            metadata: {
              email: input.email,
              fullName: input.fullName,
              designation: input.designation,
              departmentId: input.departmentId,
              roles: input.roles,
              mustChangePassword: input.mustChangePassword,
            },
          },
          { ...context, actorName: context.actorName ?? input.email.split('@')[0] ?? null },
          tx,
        );
        return userId;
      });

      this.logger.log(`Created user ${input.email} with roles ${input.roles.join(', ')}`);
      return this.findById(id);
    } catch (error) {
      if (isPgError(error, PG_UNIQUE_VIOLATION)) {
        throw new ConflictError('A user with that email already exists');
      }
      if (isPgError(error, PG_FOREIGN_KEY_VIOLATION)) {
        throw new NotFoundError('Department');
      }
      throw error;
    }
  }

  async update(id: string, input: UpdateUserInput, context: AuditContext): Promise<User> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundError('User');

    try {
      await this.repo.connection.transaction().execute(async (tx) => {
        // Inside the transaction, and holding a lock, so two concurrent demotions cannot both
        // read "there are still two admins" and both succeed.
        if (input.roles) {
          await this.assertAdminRemainsReachable(tx, existing, input.roles, context.actorId);
        }
        await this.repo.update(tx, id, {
          fullName: input.fullName,
          designation: input.designation,
          departmentId: input.departmentId,
        });
        if (input.roles) await this.repo.replaceRoles(tx, id, input.roles);
        await this.writeUpdateAudit(tx, existing, input, id, context);
      });
    } catch (error) {
      if (isPgError(error, PG_FOREIGN_KEY_VIOLATION)) throw new NotFoundError('Department');
      throw error;
    }

    return this.findById(id);
  }

  /**
   * Records the safe before/after diff for a user update. Lives next to `update` because the
   * diff is the audit row's whole reason for existing — a "user updated" without a "what
   * changed" is decoration, not history. Passwords and password hashes are NEVER included.
   */
  private async writeUpdateAudit(
    tx: Tx,
    existing: UserWithRoles,
    input: UpdateUserInput,
    id: string,
    context: AuditContext,
  ): Promise<void> {
    const before = {
      fullName: existing.full_name,
      designation: existing.designation,
      departmentId: existing.department_id,
      isActive: existing.is_active,
      roles: existing.roles,
    };
    const after = {
      ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
      ...(input.designation !== undefined ? { designation: input.designation } : {}),
      ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
      ...(input.roles !== undefined ? { roles: input.roles } : {}),
    };
    const { diffSafeFields } = await import('../audit/audit-sanitizer');
    const changes = diffSafeFields(
      before as Record<string, unknown>,
      after as Record<string, unknown>,
      ['fullName', 'designation', 'departmentId', 'roles'],
    );
    if (Object.keys(changes).length === 0) return;

    await this.audit.record(
      {
        action: 'user.update',
        entityType: 'user',
        entityId: id,
        entityRef: existing.email,
        summary: `Updated user ${existing.email}`,
        metadata: { changes },
      },
      { ...context, actorName: context.actorName ?? existing.full_name },
      tx,
    );

    // Only a role change is worth interrupting someone for — it changes what they can do and
    // what appears in their navigation. A corrected designation is not news.
    if ('roles' in changes) {
      await this.notifications.notify(
        {
          type: 'account.roles_changed',
          userIds: [id],
          ref: existing.email,
          link: NOTIFICATION_LINKS.accountPassword,
          entityType: 'user',
          entityId: id,
          actorId: context.actorId ?? null,
          actorName: context.actorName ?? null,
        },
        tx,
      );
    }
  }

  async setActive(id: string, isActive: boolean, context: AuditContext): Promise<User> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundError('User');

    if (!isActive && id === context.actorId) {
      throw new ForbiddenError('You cannot deactivate your own account');
    }

    await this.repo.connection.transaction().execute(async (tx) => {
      if (!isActive) await this.assertAdminRemainsReachable(tx, existing, [], context.actorId);
      await this.repo.update(tx, id, { isActive });
      // Deactivating must end the session immediately, not at the next access-token expiry.
      if (!isActive) {
        await tx
          .updateTable('refresh_tokens')
          .set({ revoked_at: new Date(), revoked_reason: RefreshRevocationReason.ADMIN_REVOKED })
          .where('user_id', '=', id)
          .where('revoked_at', 'is', null)
          .execute();
      }
      await this.audit.record(
        {
          action: 'user.set_active',
          entityType: 'user',
          entityId: id,
          entityRef: existing.email,
          summary: `${isActive ? 'Activated' : 'Deactivated'} user ${existing.email}`,
          metadata: {
            isActive: { before: existing.is_active, after: isActive },
            sessionsRevoked: !isActive,
          },
        },
        { ...context, actorName: context.actorName ?? existing.full_name },
        tx,
      );
    });

    return this.findById(id);
  }

  async resetPassword(
    id: string,
    input: ResetPasswordInput,
    context: AuditContext,
  ): Promise<void> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundError('User');

    const passwordHash = await this.passwords.hash(input.newPassword);
    await this.repo.connection.transaction().execute(async (tx) => {
      await this.repo.update(tx, id, {
        passwordHash,
        mustChangePassword: input.mustChangePassword,
      });
      // A password reset invalidates every existing session for that user.
      await tx
        .updateTable('refresh_tokens')
        .set({ revoked_at: new Date(), revoked_reason: RefreshRevocationReason.ADMIN_REVOKED })
        .where('user_id', '=', id)
        .where('revoked_at', 'is', null)
        .execute();
      await this.audit.record(
        {
          action: 'user.reset_password',
          entityType: 'user',
          entityId: id,
          entityRef: existing.email,
          summary: `Reset password for ${existing.email}`,
          metadata: {
            mustChangePassword: { before: existing.must_change_password, after: input.mustChangePassword },
            sessionsRevoked: true,
          },
        },
        { ...context, actorName: context.actorName ?? existing.full_name },
        tx,
      );

      // Someone else changing your password and ending your sessions is exactly the event a
      // user must not first learn about by being logged out.
      await this.notifications.notify(
        {
          type: 'account.password_reset',
          userIds: [id],
          ref: existing.email,
          link: NOTIFICATION_LINKS.accountPassword,
          entityType: 'user',
          entityId: id,
          actorId: context.actorId ?? null,
          actorName: context.actorName ?? null,
        },
        tx,
      );
    });
  }

  async changeOwnPassword(
    id: string,
    currentPassword: string,
    newPassword: string,
    context: AuditContext,
  ): Promise<void> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundError('User');

    const ok = await this.passwords.verify(existing.password_hash, currentPassword);
    if (!ok) throw new ForbiddenError('Current password is incorrect');

    await this.resetPassword(
      id,
      { newPassword, mustChangePassword: false },
      { ...context, actorName: context.actorName ?? existing.full_name },
    );
  }

  async touchLastLogin(id: string): Promise<void> {
    await this.repo.touchLastLogin(id);
  }

  /**
   * An admin panel that can lock every admin out of the admin panel is a support ticket that
   * ends in a manual SQL update on production. Refuse instead.
   */
  private async assertAdminRemainsReachable(
    tx: Tx,
    target: UserWithRoles,
    nextRoles: readonly Role[],
    actorId: string | null,
  ): Promise<void> {
    const wasAdmin = target.roles.includes(Role.ADMIN);
    const staysAdmin = nextRoles.includes(Role.ADMIN);
    if (!wasAdmin || staysAdmin) return;

    // Only counts admins who could actually sign in. A deactivated admin cannot rescue anyone.
    const activeAdmins = await this.repo.countActiveHoldersForUpdate(tx, Role.ADMIN);

    // An inactive target is not one of the reachable admins, so removing their role cannot be
    // what locks everyone out — without this, demoting a deactivated admin is refused for a
    // reason that is not true.
    const reachableWithoutTarget = target.is_active ? activeAdmins - 1 : activeAdmins;
    if (reachableWithoutTarget < 1) {
      throw new ConflictError('This is the last active administrator and cannot be removed');
    }
    if (actorId !== null && target.id === actorId) {
      throw new ForbiddenError('You cannot remove your own administrator role');
    }
  }
}