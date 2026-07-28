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
import { UsersRepository, toUser, type UserWithRoles } from './users.repository';

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

  async create(input: CreateUserInput): Promise<User> {
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

  async update(id: string, input: UpdateUserInput, actorId: string): Promise<User> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundError('User');

    if (input.roles) await this.assertAdminRemainsReachable(existing, input.roles, actorId);

    try {
      await this.repo.connection.transaction().execute(async (tx) => {
        await this.repo.update(tx, id, {
          fullName: input.fullName,
          designation: input.designation,
          departmentId: input.departmentId,
        });
        if (input.roles) await this.repo.replaceRoles(tx, id, input.roles);
      });
    } catch (error) {
      if (isPgError(error, PG_FOREIGN_KEY_VIOLATION)) throw new NotFoundError('Department');
      throw error;
    }

    return this.findById(id);
  }

  async setActive(id: string, isActive: boolean, actorId: string): Promise<User> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundError('User');

    if (!isActive) {
      if (id === actorId) throw new ForbiddenError('You cannot deactivate your own account');
      await this.assertAdminRemainsReachable(existing, [], actorId);
    }

    await this.repo.connection.transaction().execute(async (tx) => {
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
    });

    return this.findById(id);
  }

  async resetPassword(id: string, input: ResetPasswordInput): Promise<void> {
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
    });
  }

  async changeOwnPassword(id: string, currentPassword: string, newPassword: string): Promise<void> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundError('User');

    const ok = await this.passwords.verify(existing.password_hash, currentPassword);
    if (!ok) throw new ForbiddenError('Current password is incorrect');

    await this.resetPassword(id, { newPassword, mustChangePassword: false });
  }

  async touchLastLogin(id: string): Promise<void> {
    await this.repo.touchLastLogin(id);
  }

  /**
   * An admin panel that can lock every admin out of the admin panel is a support ticket that
   * ends in a manual SQL update on production. Refuse instead.
   */
  private async assertAdminRemainsReachable(
    target: UserWithRoles,
    nextRoles: readonly Role[],
    actorId: string,
  ): Promise<void> {
    const wasAdmin = target.roles.includes(Role.ADMIN);
    const staysAdmin = nextRoles.includes(Role.ADMIN);
    if (!wasAdmin || staysAdmin) return;

    const activeAdmins = await this.repo.countByRole(Role.ADMIN);
    if (activeAdmins <= 1) {
      throw new ConflictError('This is the last active administrator and cannot be removed');
    }
    if (target.id === actorId) {
      throw new ForbiddenError('You cannot remove your own administrator role');
    }
  }
}
