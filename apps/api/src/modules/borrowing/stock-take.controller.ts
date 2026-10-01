import { Body, Controller, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiKeyScope,
  IDEMPOTENCY_HEADER,
  Role,
  takeStockSchema,
  type TakeStockInput,
  type TakeStockResult,
} from '@ims/shared';
import { ConflictError, ValidationFailedError } from '../../common/errors';
import { IdempotencyService } from '../../common/idempotency.service';
import { AuthenticatedThrottle, TakeThrottle } from '../../common/throttling';
import { zodPipe } from '../../common/zod-validation.pipe';
import { ApiKeyScopes } from '../api-keys/api-key.decorators';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/request-user';
import { CurrentAuditContext } from '../audit/audit.decorators';
import type { AuditContext } from '../audit/audit-context';
import { StockTakeService } from './stock-take.service';

/**
 * `POST /stock/take` (ADR-0002).
 *
 * Mounted under `stock` because that is where an integrator looks for it, but it lives in the
 * borrowing module: a take *is* a borrow, and StockModule importing BorrowingModule would be a
 * cycle (BorrowingModule already imports StockModule).
 */
@AuthenticatedThrottle
@Controller('stock')
export class StockTakeController {
  constructor(
    private readonly takes: StockTakeService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * **`Idempotency-Key` is required**, not merely accepted: a panel on flaky Wi-Fi retries, and
   * a retried take that ran twice hands over twice with nothing to detect it. The key is scoped
   * to the caller, so two panels cannot collide, and a replay returns the first answer.
   */
  @ApiKeyScopes({
    summary:
      'Take stock off a shelf in one call. The item is recorded against the caller; put a name in "purpose" if a person is holding it.',
    scopes: [ApiKeyScope.STOCK_TAKE],
    body: takeStockSchema,
    requiresIdempotencyKey: true,
    isEnabled: (config) => config.directTake.isEnabled,
  })
  @Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
  @TakeThrottle
  @Post('take')
  @HttpCode(HttpStatus.CREATED)
  async take(
    @Body(zodPipe(takeStockSchema)) body: TakeStockInput,
    @CurrentUser() actor: RequestUser,
    @CurrentAuditContext() ctx: AuditContext,
    @Headers(IDEMPOTENCY_HEADER) idempotencyKey?: string,
  ): Promise<TakeStockResult> {
    // Before the Idempotency-Key check, so a switched-off feature says so rather than asking
    // for a header. (Body validation, the key's scope and the role check all run earlier still —
    // they are pipes and guards.)
    this.takes.assertEnabled();

    const key = idempotencyKey?.trim();
    if (!key) {
      throw new ValidationFailedError({
        path: IDEMPOTENCY_HEADER,
        message: 'Send an Idempotency-Key header, a fresh random value for each distinct take',
      });
    }

    const outcome = await this.idempotency.run(
      { key, userId: actor.id, scope: `stock:take:${body.productId}:${body.compartmentId}` },
      () => this.takes.take(body, actor.id, ctx),
    );
    if ('inFlight' in outcome) {
      // Same answer every other idempotent route gives: the first attempt has not finished.
      throw new ConflictError('That request is already being processed. Try again in a moment.');
    }
    return outcome.result;
  }
}
