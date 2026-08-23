import { Controller, Get, Query } from '@nestjs/common';
import {
  Role,
  selectableUsersQuerySchema,
  type Paginated,
  type SelectableUser,
  type SelectableUsersQuery,
} from '@ims/shared';
import { zodPipe } from '../../common/zod-validation.pipe';
import { AuthenticatedThrottle } from '../../common/throttling';
import { Roles } from '../auth/auth.decorators';
import { UsersService } from './users.service';

/**
 * The one endpoint behind two pickers: the approver's delegate picker (D-023) and the IM's
 * borrow-to-user picker (OQ-22). Separate from `UsersController` because that class is
 * `@Roles(ADMIN)` at the class level and this is not admin-only — merging them would put an
 * approver-readable route one decorator away from the admin surface.
 *
 * The expansion is convenience over access these roles already have: `OVERSIGHT_ROLES` lets
 * any approver open any requisition, and `ApprovalTracker` renders every assignee's name and
 * designation. Those two fields are exactly what this returns.
 */
@AuthenticatedThrottle
@Roles(Role.APPROVER, Role.INVENTORY_MANAGER, Role.ADMIN)
@Controller('users')
export class SelectableUsersController {
  constructor(private readonly users: UsersService) {}

  /**
   * Candidates are NOT filtered by whether they already hold a delegation from the caller
   * (ruling 2026-08-23): the one-live-delegation rule is a constraint on the approver's window,
   * and hiding candidates would present it as an empty list instead of the 409 it is.
   */
  @Get('selectable')
  async listSelectable(
    @Query(zodPipe(selectableUsersQuerySchema)) query: SelectableUsersQuery,
  ): Promise<Paginated<SelectableUser>> {
    return this.users.listSelectable(query);
  }
}
