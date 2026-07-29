import { Global, Module } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service';

/**
 * Cross-cutting services with no feature of their own.
 *
 * Global because idempotency is claimed by feature modules (borrowing today, requisitions and
 * purchasing later) and pruned by the maintenance job. Registering it per module would give
 * each one its own instance and, worse, invite someone to forget it.
 */
@Global()
@Module({
  providers: [IdempotencyService],
  exports: [IdempotencyService],
})
export class CommonModule {}
