import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery, ApiParam } from '@nestjs/swagger';
import { BillService } from './bill.service';
import { CreateBillDto, UpdateBillDto, RecordBillPaymentDto, BillStatus } from './dto/bill.dto';

@ApiTags('bills')
@ApiBearerAuth()
@Controller('organizations/:organizationId/bills')
export class BillController {
  constructor(private readonly billService: BillService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new bill' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  async create(
    @Param('organizationId') organizationId: string,
    @Body() dto: CreateBillDto,
  ) {
    return this.billService.create(organizationId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all bills' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiQuery({ name: 'vendorId', required: false })
  @ApiQuery({ name: 'status', required: false, enum: BillStatus })
  @ApiQuery({ name: 'startDate', required: false, type: Date })
  @ApiQuery({ name: 'endDate', required: false, type: Date })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  async findAll(
    @Param('organizationId') organizationId: string,
    @Query('vendorId') vendorId?: string,
    @Query('status') status?: BillStatus,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.billService.findAll(organizationId, {
      vendorId,
      status,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      skip: skip ? parseInt(skip, 10) : undefined,
      take: take ? parseInt(take, 10) : undefined,
    });
  }

  @Get('aging')
  @ApiOperation({ summary: 'Get AP aging report' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  async getAgingReport(@Param('organizationId') organizationId: string) {
    return this.billService.getAPAgingReport(organizationId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get bill by ID' })
  async findById(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.billService.findById(organizationId, id);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve bill' })
  async approve(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.billService.approve(organizationId, id);
  }

  @Post(':id/payment')
  @ApiOperation({ summary: 'Record payment for bill' })
  async recordPayment(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @Body() dto: RecordBillPaymentDto,
  ) {
    return this.billService.recordPayment(organizationId, id, dto);
  }
}
