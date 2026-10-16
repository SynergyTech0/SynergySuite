import { Controller, Get, Post, Body, Param, Put, Delete, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { EstimateService } from './estimate.service';
import { CreateEstimateDto } from './dto/create-estimate.dto';

@ApiTags('estimates')
@ApiBearerAuth()
@Controller('organizations/:organizationId/estimates')
export class EstimateController {
  constructor(private readonly estimateService: EstimateService) {}

  @Post()
  @ApiOperation({ summary: 'Create an estimate' })
  async createEstimate(
    @Param('organizationId') organizationId: string,
    @Body() dto: CreateEstimateDto,
  ) {
    return this.estimateService.createEstimate(organizationId, dto);
  }

  @Get(':estimateId')
  @ApiOperation({ summary: 'Get an estimate' })
  async getEstimate(
    @Param('organizationId') organizationId: string,
    @Param('estimateId') estimateId: string,
  ) {
    return this.estimateService.getEstimate(organizationId, estimateId);
  }

  @Get()
  @ApiOperation({ summary: 'List estimates' })
  async listEstimates(
    @Param('organizationId') organizationId: string,
    @Query('customerId') customerId?: string,
    @Query('status') status?: string,
  ) {
    return this.estimateService.getEstimates(organizationId, { customerId, status });
  }

  @Post(':estimateId/convert-to-invoice')
  @ApiOperation({ summary: 'Convert estimate to invoice' })
  async convertToInvoice(
    @Param('organizationId') organizationId: string,
    @Param('estimateId') estimateId: string,
    @Body('invoiceDate') invoiceDate?: string,
  ) {
    return this.estimateService.convertToInvoice(organizationId, estimateId, invoiceDate ? new Date(invoiceDate) : undefined);
  }

  @Put(':estimateId/status')
  @ApiOperation({ summary: 'Update estimate status' })
  async updateStatus(
    @Param('organizationId') organizationId: string,
    @Param('estimateId') estimateId: string,
    @Body('status') status: string,
  ) {
    return this.estimateService.updateEstimateStatus(organizationId, estimateId, status);
  }

  @Delete(':estimateId')
  @ApiOperation({ summary: 'Delete an estimate' })
  async deleteEstimate(
    @Param('organizationId') organizationId: string,
    @Param('estimateId') estimateId: string,
  ) {
    return this.estimateService.deleteEstimate(organizationId, estimateId);
  }
}
