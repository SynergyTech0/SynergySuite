import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuditTrailService } from './audit-trail.service';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('organizations/:organizationId/audit')
export class AuditTrailController {
  constructor(private readonly auditTrailService: AuditTrailService) {}

  @Get('trail')
  @ApiOperation({ summary: 'Get audit trail' })
  async getAuditTrail(
    @Param('organizationId') organizationId: string,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('userId') userId?: string,
    @Query('actionType') actionType?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.auditTrailService.getAuditTrail(organizationId, {
      entityType,
      entityId,
      userId,
      actionType,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });
  }

  @Get('user/:userId/activity')
  @ApiOperation({ summary: 'Get user activity' })
  async getUserActivity(
    @Param('organizationId') organizationId: string,
    @Param('userId') userId: string,
    @Query('days') days?: string,
  ) {
    return this.auditTrailService.getUserActivity(organizationId, userId, days ? parseInt(days) : 30);
  }

  @Get('entity/:entityType/:entityId')
  @ApiOperation({ summary: 'Get entity history' })
  async getEntityHistory(
    @Param('organizationId') organizationId: string,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ) {
    return this.auditTrailService.getEntityHistory(organizationId, entityType, entityId);
  }

  @Get('report')
  @ApiOperation({ summary: 'Generate audit report' })
  async generateReport(
    @Param('organizationId') organizationId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.auditTrailService.generateAuditReport(organizationId, new Date(startDate), new Date(endDate));
  }
}
