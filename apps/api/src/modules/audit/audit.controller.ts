import { Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { Role, type AuditEntry, type ListAuditQuery, type Paginated } from '@ims/shared';
import { zodPipe } from '../../common/zod-validation.pipe';
import { Roles } from '../auth/auth.decorators';
import { listAuditQuerySchema } from '@ims/shared';
import { AuditService } from './audit.service';

/**
 * Admin-only endpoints for the audit feed. `Roles(Role.ADMIN)` is the same pattern every
 * other admin route in this codebase uses; non-admins get 403 before reaching the handler.
 */
@Roles(Role.ADMIN)
@Controller('admin/audit-log')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /** Paginated, filterable list of audit rows, newest first. */
  @Get()
  async list(
    @Query(zodPipe(listAuditQuerySchema)) query: ListAuditQuery,
  ): Promise<Paginated<AuditEntry>> {
    return this.audit.list(query);
  }

  /** Detail drawer payload. The list endpoint already shows the summary; this returns the full sanitised metadata. */
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AuditEntry> {
    const entry = await this.audit.findById(id);
    if (!entry) {
      throw new NotFoundException({ code: 'AUDIT_ENTRY_NOT_FOUND', message: 'Audit entry not found' });
    }
    return entry;
  }
}
