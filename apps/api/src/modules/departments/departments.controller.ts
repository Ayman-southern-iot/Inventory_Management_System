import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  Role,
  createDepartmentSchema,
  listDepartmentsQuerySchema,
  updateDepartmentSchema,
  type CreateDepartmentInput,
  type Department,
  type ListDepartmentsQuery,
  type Paginated,
  type UpdateDepartmentInput,
} from '@ims/shared';
import { zodPipe } from '../../common/zod-validation.pipe';
import { Roles } from '../auth/auth.decorators';
import { CurrentAuditContext } from '../audit/audit.decorators';
import type { AuditContext } from '../audit/audit-context';
import { DepartmentsService } from './departments.service';

@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  /** Readable by any authenticated user — the requisition and profile forms need the list. */
  @Get()
  async list(
    @Query(zodPipe(listDepartmentsQuerySchema)) query: ListDepartmentsQuery,
  ): Promise<Paginated<Department>> {
    return this.departments.list(query);
  }

  @Roles(Role.ADMIN)
  @Post()
  async create(
    @Body(zodPipe(createDepartmentSchema)) body: CreateDepartmentInput,
    @CurrentAuditContext() ctx: AuditContext,
  ): Promise<Department> {
    return this.departments.create(body, ctx);
  }

  @Roles(Role.ADMIN)
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateDepartmentSchema)) body: UpdateDepartmentInput,
    @CurrentAuditContext() ctx: AuditContext,
  ): Promise<Department> {
    return this.departments.update(id, body, ctx);
  }
}
