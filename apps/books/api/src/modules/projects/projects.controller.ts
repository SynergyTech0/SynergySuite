import { Controller, Get, Post, Put, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ProjectsService } from './projects.service';
import { SuiteAuthGuard } from '../auth/guards/suite-auth.guard';

@ApiTags('Projects & Job Costing')
@Controller('organizations/:organizationId/projects')
@UseGuards(SuiteAuthGuard)
@ApiBearerAuth()
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @ApiOperation({ summary: 'Create project' })
  async createProject(@Param('organizationId') organizationId: string, @Body() data: any) {
    return this.projectsService.createProject(organizationId, data);
  }

  @Get()
  @ApiOperation({ summary: 'List projects' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'managerId', required: false })
  async getProjects(
    @Param('organizationId') organizationId: string,
    @Query('status') status?: string,
    @Query('customerId') customerId?: string,
    @Query('managerId') managerId?: string,
  ) {
    return this.projectsService.getProjects(organizationId, { status, customerId, managerId });
  }

  @Get(':projectId')
  @ApiOperation({ summary: 'Get project details' })
  async getProject(@Param('organizationId') organizationId: string, @Param('projectId') projectId: string) {
    return this.projectsService.getProject(organizationId, projectId);
  }

  @Put(':projectId')
  @ApiOperation({ summary: 'Update project' })
  async updateProject(
    @Param('organizationId') organizationId: string,
    @Param('projectId') projectId: string,
    @Body() data: any,
  ) {
    return this.projectsService.updateProject(organizationId, projectId, data);
  }

  @Post(':projectId/close')
  @ApiOperation({ summary: 'Close project' })
  async closeProject(@Param('organizationId') organizationId: string, @Param('projectId') projectId: string) {
    return this.projectsService.closeProject(organizationId, projectId);
  }

  @Post(':projectId/reopen')
  @ApiOperation({ summary: 'Reopen project' })
  async reopenProject(@Param('organizationId') organizationId: string, @Param('projectId') projectId: string) {
    return this.projectsService.reopenProject(organizationId, projectId);
  }

  // Tasks
  @Post(':projectId/tasks')
  @ApiOperation({ summary: 'Create project task' })
  async createTask(
    @Param('organizationId') organizationId: string,
    @Param('projectId') projectId: string,
    @Body() data: any,
  ) {
    return this.projectsService.createTask(organizationId, projectId, data);
  }

  @Get(':projectId/tasks')
  @ApiOperation({ summary: 'List project tasks' })
  @ApiQuery({ name: 'status', required: false })
  async getTasks(
    @Param('organizationId') organizationId: string,
    @Param('projectId') projectId: string,
    @Query('status') status?: string,
  ) {
    return this.projectsService.getTasks(organizationId, projectId, { status });
  }

  @Put(':projectId/tasks/:taskId')
  @ApiOperation({ summary: 'Update project task' })
  async updateTask(
    @Param('organizationId') organizationId: string,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
    @Body() data: any,
  ) {
    return this.projectsService.updateTask(organizationId, projectId, taskId, data);
  }

  // Job Costing
  @Get(':projectId/costs')
  @ApiOperation({ summary: 'Get project costs and profitability' })
  async getProjectCosts(@Param('organizationId') organizationId: string, @Param('projectId') projectId: string) {
    return this.projectsService.getProjectCosts(organizationId, projectId);
  }

  @Get(':projectId/progress')
  @ApiOperation({ summary: 'Get project progress' })
  async getProjectProgress(@Param('organizationId') organizationId: string, @Param('projectId') projectId: string) {
    return this.projectsService.getProjectProgress(organizationId, projectId);
  }
}
