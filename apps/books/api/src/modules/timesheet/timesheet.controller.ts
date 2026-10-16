import { Controller, Get, Post, Body, Param, Put, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TimesheetService, CreateTimesheetDto } from './timesheet.service';

@ApiTags('timesheets')
@ApiBearerAuth()
@Controller('organizations/:organizationId/timesheets')
export class TimesheetController {
  constructor(private readonly timesheetService: TimesheetService) {}

  @Post()
  @ApiOperation({ summary: 'Create a timesheet' })
  async createTimesheet(
    @Param('organizationId') organizationId: string,
    @Body() dto: CreateTimesheetDto,
  ) {
    return this.timesheetService.createTimesheet(organizationId, dto);
  }

  @Get(':timesheetId')
  @ApiOperation({ summary: 'Get a timesheet' })
  async getTimesheet(
    @Param('organizationId') organizationId: string,
    @Param('timesheetId') timesheetId: string,
  ) {
    return this.timesheetService.getTimesheet(organizationId, timesheetId);
  }

  @Get()
  @ApiOperation({ summary: 'List timesheets' })
  async listTimesheets(
    @Param('organizationId') organizationId: string,
    @Query('employeeId') employeeId?: string,
    @Query('status') status?: string,
  ) {
    return this.timesheetService.listTimesheets(organizationId, { employeeId, status });
  }

  @Put(':timesheetId/submit')
  @ApiOperation({ summary: 'Submit a timesheet' })
  async submitTimesheet(
    @Param('organizationId') organizationId: string,
    @Param('timesheetId') timesheetId: string,
  ) {
    return this.timesheetService.submitTimesheet(organizationId, timesheetId, 'user-id');
  }

  @Put(':timesheetId/approve')
  @ApiOperation({ summary: 'Approve a timesheet' })
  async approveTimesheet(
    @Param('organizationId') organizationId: string,
    @Param('timesheetId') timesheetId: string,
  ) {
    return this.timesheetService.approveTimesheet(organizationId, timesheetId, 'user-id');
  }

  @Get('employee/:employeeId/hours')
  @ApiOperation({ summary: 'Get employee hours' })
  async getEmployeeHours(
    @Param('organizationId') organizationId: string,
    @Param('employeeId') employeeId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.timesheetService.getEmployeeHours(
      organizationId,
      employeeId,
      new Date(startDate),
      new Date(endDate),
    );
  }
}
