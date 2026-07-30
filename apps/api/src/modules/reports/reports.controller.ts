import { Controller, Get, Query } from '@nestjs/common';
import {
  Role,
  expenseReportQuerySchema,
  type ExpenseReport,
  type ExpenseReportQuery,
} from '@ims/shared';
import { zodPipe } from '../../common/zod-validation.pipe';
import { Roles } from '../auth/auth.decorators';
import { ReportsService } from './reports.service';

/**
 * Organisation-wide spend.
 *
 * `@Roles` excludes General deliberately: an approver needs the shape of the spend they are
 * sanctioning and an IM needs it to plan, but a requester browsing every department's figures is
 * not a use case anyone asked for, and money is the one thing worth being conservative about.
 */
@Controller('reports')
@Roles(Role.APPROVER, Role.INVENTORY_MANAGER, Role.ADMIN)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('expenses')
  async expenses(
    @Query(zodPipe(expenseReportQuerySchema)) query: ExpenseReportQuery,
  ): Promise<ExpenseReport> {
    return this.reports.expenses(query);
  }
}
