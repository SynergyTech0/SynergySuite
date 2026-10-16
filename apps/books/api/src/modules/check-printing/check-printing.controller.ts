import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { SuiteAuthGuard } from '../auth/guards/suite-auth.guard';
import { CheckPrintingService, CreateCheckTemplateDto, PrintCheckDto, CreateCheckBatchDto } from './check-printing.service';

@Controller('check-printing')
@UseGuards(SuiteAuthGuard)
export class CheckPrintingController {
  constructor(private readonly checkPrintingService: CheckPrintingService) {}

  // Templates
  @Post('templates')
  async createTemplate(@Request() req: any, @Body() dto: CreateCheckTemplateDto) {
    return this.checkPrintingService.createTemplate(req.user.organizationId, dto);
  }

  @Get('templates')
  async getTemplates(@Request() req: any) {
    return this.checkPrintingService.getTemplates(req.user.organizationId);
  }

  @Get('templates/:id')
  async getTemplate(@Request() req: any, @Param('id') id: string) {
    return this.checkPrintingService.getTemplate(req.user.organizationId, id);
  }

  @Put('templates/:id')
  async updateTemplate(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: Partial<CreateCheckTemplateDto>,
  ) {
    return this.checkPrintingService.updateTemplate(req.user.organizationId, id, dto);
  }

  // Single Check
  @Post('print')
  async printCheck(@Request() req: any, @Body() dto: PrintCheckDto) {
    return this.checkPrintingService.printCheck(req.user.organizationId, dto, req.user.id);
  }

  // Batch Printing
  @Post('batches')
  async createBatch(@Request() req: any, @Body() dto: CreateCheckBatchDto) {
    return this.checkPrintingService.createCheckBatch(req.user.organizationId, dto, req.user.id);
  }

  @Post('batches/:id/print')
  async printBatch(@Request() req: any, @Param('id') id: string) {
    return this.checkPrintingService.printBatch(req.user.organizationId, id, req.user.id);
  }

  @Post('checks/:id/void')
  async voidCheck(
    @Request() req: any,
    @Param('id') id: string,
    @Body('reason') reason: string,
  ) {
    return this.checkPrintingService.voidCheck(req.user.organizationId, id, reason, req.user.id);
  }

  // History
  @Get('history')
  async getCheckHistory(
    @Request() req: any,
    @Query('templateId') templateId?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('payeeName') payeeName?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.checkPrintingService.getCheckHistory(req.user.organizationId, {
      templateId,
      status,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      payeeName,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }
}
