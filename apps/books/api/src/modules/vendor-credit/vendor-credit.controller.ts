import { Controller, Get, Post, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { VendorCreditService } from './vendor-credit.service';
import { SuiteAuthGuard } from '../auth/guards/suite-auth.guard';

@ApiTags('Vendor Credits')
@Controller('organizations/:organizationId/vendor-credits')
@UseGuards(SuiteAuthGuard)
@ApiBearerAuth()
export class VendorCreditController {
  constructor(private readonly vendorCreditService: VendorCreditService) {}

  @Post()
  @ApiOperation({ summary: 'Create vendor credit' })
  async create(@Param('organizationId') organizationId: string, @Body() data: any, @Req() req: any) {
    return this.vendorCreditService.create(organizationId, { ...data, createdBy: req.user?.id || 'system' });
  }

  @Get()
  @ApiOperation({ summary: 'List vendor credits' })
  @ApiQuery({ name: 'vendorId', required: false })
  @ApiQuery({ name: 'status', required: false })
  async list(
    @Param('organizationId') organizationId: string,
    @Query('vendorId') vendorId?: string,
    @Query('status') status?: string,
  ) {
    return this.vendorCreditService.list(organizationId, { vendorId, status });
  }

  @Get(':vendorCreditId')
  @ApiOperation({ summary: 'Get vendor credit details' })
  async get(@Param('organizationId') organizationId: string, @Param('vendorCreditId') vendorCreditId: string) {
    return this.vendorCreditService.get(organizationId, vendorCreditId);
  }

  @Post(':vendorCreditId/receive')
  @ApiOperation({ summary: 'Mark vendor credit as received' })
  async receive(@Param('organizationId') organizationId: string, @Param('vendorCreditId') vendorCreditId: string) {
    return this.vendorCreditService.receive(organizationId, vendorCreditId);
  }

  @Post(':vendorCreditId/apply')
  @ApiOperation({ summary: 'Apply vendor credit to bill' })
  async apply(
    @Param('organizationId') organizationId: string,
    @Param('vendorCreditId') vendorCreditId: string,
    @Body() body: { billId: string; amount: number },
    @Req() req: any,
  ) {
    return this.vendorCreditService.applyToBill(organizationId, vendorCreditId, body.billId, body.amount, req.user?.id || 'system');
  }
}
