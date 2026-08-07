import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  IDEMPOTENCY_HEADER,
  Role,
  createDelegationSchema,
  decideRequisitionSchema,
  listRequisitionsQuerySchema,
  saveRequisitionSchema,
  withdrawApprovalSchema,
  type CreateDelegationInput,
  type DecideRequisitionInput,
  type Delegation,
  type ListRequisitionsQuery,
  type Paginated,
  type Requisition,
  type RequisitionDetail,
  type SaveRequisitionInput,
  type WithdrawApprovalInput,
} from '@ims/shared';
import { ConflictError, ForbiddenError } from '../../common/errors';
import { IdempotencyService } from '../../common/idempotency.service';
import { zodPipe } from '../../common/zod-validation.pipe';
import { AuthenticatedThrottle } from '../../common/throttling';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/request-user';
import { DelegationsService } from './delegations.service';
import { RequisitionsRepository } from './requisitions.repository';
import { RequisitionsService } from './requisitions.service';

/** Roles that see everyone's requisitions rather than only their own. */
const OVERSIGHT_ROLES = [Role.INVENTORY_MANAGER, Role.APPROVER, Role.ADMIN] as const;

@AuthenticatedThrottle
@Controller('requisitions')
export class RequisitionsController {
  constructor(
    private readonly requisitions: RequisitionsService,
    private readonly repo: RequisitionsRepository,
    private readonly delegations: DelegationsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * Anyone may raise a requisition, so the list is open — but a caller with no oversight role
   * only ever sees their own, enforced here rather than by trusting the `mine` flag.
   */
  @Get()
  async list(
    @Query(zodPipe(listRequisitionsQuerySchema)) query: ListRequisitionsQuery,
    @CurrentUser() actor: RequestUser,
  ): Promise<Paginated<Requisition>> {
    const hasOversight = OVERSIGHT_ROLES.some((role) => actor.roles.includes(role));
    return this.repo.list(query, {
      actorId: actor.id,
      restrictToRequester: !hasOversight,
    });
  }

  /** Powers the approver's pending badge (tasks 3.7, 3.8). */
  @Roles(Role.INVENTORY_MANAGER, Role.APPROVER, Role.ADMIN)
  @Get('awaiting-count')
  async awaitingCount(@CurrentUser() actor: RequestUser): Promise<{ count: number }> {
    return { count: await this.repo.countAwaiting(actor.id) };
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: RequestUser,
  ): Promise<RequisitionDetail> {
    const detail = await this.requisitions.requireDetail(id);
    const hasOversight = OVERSIGHT_ROLES.some((role) => actor.roles.includes(role));
    // Someone else's requisition is not yours to read unless you have a part in approving it.
    if (!hasOversight && detail.requesterId !== actor.id) {
      throw new ForbiddenError('That requisition is not yours');
    }
    // The repo leaves the URL null so HTTP stays out of the repository layer. Build it here so
    // the detail page can hand the card a single click target.
    return {
      ...detail,
      supportingDocumentUrl: detail.supportingDocument
        ? `/api/v1/requisitions/${id}/supporting-document`
        : null,
    };
  }

  @Post()
  async create(
    @Body(zodPipe(saveRequisitionSchema)) body: SaveRequisitionInput,
    @CurrentUser() actor: RequestUser,
  ): Promise<RequisitionDetail> {
    return this.requisitions.createDraft(body, actor.id);
  }

  @Put(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(saveRequisitionSchema)) body: SaveRequisitionInput,
    @CurrentUser() actor: RequestUser,
  ): Promise<RequisitionDetail> {
    return this.requisitions.updateDraft(id, body, actor.id);
  }

  /** Idempotent: a double-clicked Submit must not seed two approval chains. */
  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  async submit(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: RequestUser,
    @Headers(IDEMPOTENCY_HEADER) idempotencyKey?: string,
  ): Promise<RequisitionDetail> {
    return this.runOnce(idempotencyKey, actor.id, `requisition:submit:${id}`, () =>
      this.requisitions.submit(id, actor.id),
    );
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: RequestUser,
  ): Promise<RequisitionDetail> {
    return this.requisitions.cancel(id, actor.id);
  }

  /**
   * One approval decision. Not role-gated at the guard: the authority comes from the approval
   * row being assigned to you (or to someone you are standing in for), which the guard cannot
   * see. The service checks it.
   */
  @Post('approvals/:approvalId/decision')
  @HttpCode(HttpStatus.OK)
  async decide(
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
    @Body(zodPipe(decideRequisitionSchema)) body: DecideRequisitionInput,
    @CurrentUser() actor: RequestUser,
    @Headers(IDEMPOTENCY_HEADER) idempotencyKey?: string,
  ): Promise<RequisitionDetail> {
    return this.runOnce(idempotencyKey, actor.id, `approval:decide:${approvalId}`, () =>
      this.requisitions.decide(approvalId, body, actor.id),
    );
  }

  @Post('approvals/:approvalId/withdraw')
  @HttpCode(HttpStatus.OK)
  async withdraw(
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
    @Body(zodPipe(withdrawApprovalSchema)) body: WithdrawApprovalInput,
    @CurrentUser() actor: RequestUser,
  ): Promise<RequisitionDetail> {
    return this.requisitions.withdraw(approvalId, body, actor.id);
  }

  /* ------------------------------------------------------------ delegation */

  @Roles(Role.APPROVER, Role.ADMIN)
  @Get('delegations/mine')
  async myDelegations(@CurrentUser() actor: RequestUser): Promise<Delegation[]> {
    return this.delegations.list(actor.id);
  }

  @Roles(Role.APPROVER, Role.ADMIN)
  @Post('delegations')
  async createDelegation(
    @Body(zodPipe(createDelegationSchema)) body: CreateDelegationInput,
    @CurrentUser() actor: RequestUser,
  ): Promise<Delegation> {
    return this.delegations.create(body, actor.id);
  }

  @Roles(Role.APPROVER, Role.ADMIN)
  @Delete('delegations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeDelegation(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: RequestUser,
  ): Promise<void> {
    await this.delegations.revoke(id, actor.id);
  }

  private async runOnce<T>(
    key: string | undefined,
    userId: string,
    scope: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const outcome = await this.idempotency.run({ key, userId, scope }, operation);
    if ('inFlight' in outcome) {
      throw new ConflictError('That request is already being processed. Try again in a moment.');
    }
    return outcome.result;
  }
}
