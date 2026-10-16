import { Controller, Get, Post, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { RecurringService } from './recurring.service';
import { SuiteAuthGuard } from '../auth/guards/suite-auth.guard';

@ApiTags('Recurring Transactions')
@Controller('organizations/:organizationId/recurring')
@UseGuards(SuiteAuthGuard)
@ApiBearerAuth()
export class RecurringController {
  constructor(private readonly recurringService: RecurringService) {}

  @Post('templates')
  @ApiOperation({ summary: 'Create recurring template' })
  async createTemplate(@Param('organizationId') organizationId: string, @Body() data: any, @Req() req: any) {
    return this.recurringService.createTemplate(organizationId, { ...data, createdBy: req.user?.id || 'system' });
  }

  @Get('templates')
  @ApiOperation({ summary: 'List recurring templates' })
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({ name: 'status', required: false })
  async getTemplates(
    @Param('organizationId') organizationId: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
  ) {
    return this.recurringService.getTemplates(organizationId, { type, status });
  }

  @Get('templates/:templateId')
  @ApiOperation({ summary: 'Get template details' })
  async getTemplate(@Param('organizationId') organizationId: string, @Param('templateId') templateId: string) {
    return this.recurringService.getTemplate(organizationId, templateId);
  }

  @Post('templates/:templateId/pause')
  @ApiOperation({ summary: 'Pause recurring template' })
  async pauseTemplate(@Param('organizationId') organizationId: string, @Param('templateId') templateId: string) {
    return this.recurringService.pauseTemplate(organizationId, templateId);
  }

  @Post('templates/:templateId/resume')
  @ApiOperation({ summary: 'Resume recurring template' })
  async resumeTemplate(@Param('organizationId') organizationId: string, @Param('templateId') templateId: string) {
    return this.recurringService.resumeTemplate(organizationId, templateId);
  }

  @Post('templates/:templateId/cancel')
  @ApiOperation({ summary: 'Cancel recurring template' })
  async cancelTemplate(@Param('organizationId') organizationId: string, @Param('templateId') templateId: string) {
    return this.recurringService.cancelTemplate(organizationId, templateId);
  }

  @Get('upcoming')
  @ApiOperation({ summary: 'Get upcoming recurring transactions' })
  @ApiQuery({ name: 'days', required: false })
  async getUpcoming(@Param('organizationId') organizationId: string, @Query('days') days?: string) {
    return this.recurringService.getUpcoming(organizationId, days ? parseInt(days) : 30);
  }

  @Post('process')
  @ApiOperation({ summary: 'Process all due recurring transactions (admin)' })
  async processScheduled() {
    return this.recurringService.processScheduledTransactions();
  }
}
