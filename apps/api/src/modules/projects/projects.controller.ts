import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  Role,
  createProjectSchema,
  listProjectItemsQuerySchema,
  paginationQuerySchema,
  type CreateProjectInput,
  type ListProjectItemsQuery,
  type Paginated,
  type PaginationQuery,
  type Project,
  type ProjectDetail,
  type ProjectItem,
} from '@ims/shared';
import { zodPipe } from '../../common/zod-validation.pipe';
import { AuthenticatedThrottle } from '../../common/throttling';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/request-user';
import { CurrentAuditContext } from '../audit/audit.decorators';
import type { AuditContext } from '../audit/audit-context';
import { ProjectsService } from './projects.service';

@AuthenticatedThrottle
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  /** The hub is everyone's: no @Roles here, deliberately. */
  @Get()
  async list(
    @Query(zodPipe(paginationQuerySchema)) query: PaginationQuery,
  ): Promise<Paginated<Project>> {
    return this.projects.listPaged(query);
  }

  /** Anyone raising a borrow or a requisition may create the project it is charged to. */
  @Post()
  async create(
    @Body(zodPipe(createProjectSchema)) body: CreateProjectInput,
    @CurrentUser() actor: RequestUser,
    @CurrentAuditContext() ctx: AuditContext,
  ): Promise<Project> {
    return this.projects.create(body, actor.id, ctx);
  }

  @Get(':id')
  async detail(@Param('id', ParseUUIDPipe) id: string): Promise<ProjectDetail> {
    return this.projects.detail(id);
  }

  @Get(':id/items')
  async items(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(listProjectItemsQuerySchema)) query: ListProjectItemsQuery,
  ): Promise<Paginated<ProjectItem>> {
    return this.projects.items(id, query);
  }

  /**
   * Removes a borrow from a project. Only the IM, who owns stock accuracy — one user quietly
   * detaching another's outstanding item would hide a liability.
   */
  @Roles(Role.INVENTORY_MANAGER, Role.ADMIN)
  @Delete(':id/items/:borrowRequestId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async detachItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('borrowRequestId', ParseUUIDPipe) borrowRequestId: string,
    @CurrentAuditContext() ctx: AuditContext,
  ): Promise<void> {
    await this.projects.detachItem(id, borrowRequestId, ctx);
  }
}
