import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  IDEMPOTENCY_HEADER,
  Role,
  createBorrowRequestSchema,
  createProjectSchema,
  decideBorrowSchema,
  listBorrowsQuerySchema,
  returnBorrowSchema,
  revertBorrowSchema,
  type BorrowRequest,
  type CreateBorrowRequestInput,
  type CreateProjectInput,
  type DecideBorrowInput,
  type ListBorrowsQuery,
  type Paginated,
  type Project,
  type ReturnBorrowInput,
  type RevertBorrowInput,
} from '@ims/shared';
import { ConflictError } from '../../common/errors';
import { IdempotencyService } from '../../common/idempotency.service';
import { zodPipe } from '../../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/request-user';
import { BorrowingRepository } from './borrowing.repository';
import { BorrowingService } from './borrowing.service';
import { ProjectsService } from './projects.service';

/** Roles that may see and act on everyone's borrows. */
const STOCK_ROLES = [Role.INVENTORY_MANAGER, Role.ADMIN] as const;

@Controller('borrowing')
export class BorrowingController {
  constructor(
    private readonly borrowing: BorrowingService,
    private readonly repo: BorrowingRepository,
    private readonly projects: ProjectsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /* ------------------------------------------------------------- projects */

  @Get('projects')
  async listProjects(): Promise<Project[]> {
    return this.projects.list();
  }

  /** Anyone raising a borrow may create the project it is charged to (task 2.1). */
  @Post('projects')
  async createProject(
    @Body(zodPipe(createProjectSchema)) body: CreateProjectInput,
    @CurrentUser() actor: RequestUser,
  ): Promise<Project> {
    return this.projects.create(body, actor.id);
  }

  /* --------------------------------------------------------------- borrows */

  /**
   * The borrow log. A caller without a stock role only ever sees their own requests, whatever
   * they put in the query — the restriction is applied server-side, not by trusting `mine`.
   */
  @Get()
  async list(
    @Query(zodPipe(listBorrowsQuerySchema)) query: ListBorrowsQuery,
    @CurrentUser() actor: RequestUser,
  ): Promise<Paginated<BorrowRequest>> {
    const isStockRole = STOCK_ROLES.some((role) => actor.roles.includes(role));
    const restrictTo = !isStockRole || query.mine ? actor.id : undefined;
    return this.repo.list(query, restrictTo);
  }

  @Roles(...STOCK_ROLES)
  @Get('pending-count')
  async pendingCount(): Promise<{ count: number }> {
    return { count: await this.repo.countPending() };
  }

  @Post()
  async create(
    @Body(zodPipe(createBorrowRequestSchema)) body: CreateBorrowRequestInput,
    @CurrentUser() actor: RequestUser,
    @Headers(IDEMPOTENCY_HEADER) idempotencyKey?: string,
  ): Promise<BorrowRequest> {
    return this.runOnce(idempotencyKey, actor.id, 'borrow:create', () =>
      this.borrowing.create(body, actor.id),
    );
  }

  /**
   * Approve or reject. Idempotent by header (task 2.3): a double-clicked Approve issues stock
   * exactly once, because issuing twice is unrecoverable.
   */
  @Roles(...STOCK_ROLES)
  @Post(':id/decision')
  @HttpCode(HttpStatus.OK)
  async decide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(decideBorrowSchema)) body: DecideBorrowInput,
    @CurrentUser() actor: RequestUser,
    @Headers(IDEMPOTENCY_HEADER) idempotencyKey?: string,
  ): Promise<BorrowRequest> {
    return this.runOnce(idempotencyKey, actor.id, `borrow:decide:${id}`, () =>
      this.borrowing.decide(id, body, actor.id),
    );
  }

  @Roles(...STOCK_ROLES)
  @Post(':id/returns')
  @HttpCode(HttpStatus.OK)
  async recordReturn(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(returnBorrowSchema)) body: ReturnBorrowInput,
    @CurrentUser() actor: RequestUser,
    @Headers(IDEMPOTENCY_HEADER) idempotencyKey?: string,
  ): Promise<BorrowRequest> {
    return this.runOnce(idempotencyKey, actor.id, `borrow:return:${id}`, () =>
      this.borrowing.recordReturn(id, body, actor.id),
    );
  }

  /** OPEN QUESTION: OQ-04 — only legal before the stock has physically left. */
  @Roles(...STOCK_ROLES)
  @Post(':id/revert')
  @HttpCode(HttpStatus.OK)
  async revert(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(revertBorrowSchema)) body: RevertBorrowInput,
    @CurrentUser() actor: RequestUser,
  ): Promise<BorrowRequest> {
    return this.borrowing.revertToPending(id, body, actor.id);
  }

  /** The requester withdrawing their own request. Ownership is checked in the service. */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: RequestUser,
  ): Promise<BorrowRequest> {
    return this.borrowing.cancel(id, actor.id);
  }

  private async runOnce<T>(
    key: string | undefined,
    userId: string,
    scope: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const outcome = await this.idempotency.run({ key, userId, scope }, operation);
    if ('inFlight' in outcome) {
      // The first attempt is still running. Telling the caller to retry is honest; inventing a
      // response would be a guess about stock.
      throw new ConflictError('That request is already being processed. Try again in a moment.');
    }
    return outcome.result;
  }
}
