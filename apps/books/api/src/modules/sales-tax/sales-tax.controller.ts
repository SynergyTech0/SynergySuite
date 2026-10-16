import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SalesTaxService } from './sales-tax.service';
import { SuiteAuthGuard } from '../auth/guards/suite-auth.guard';
import { 
  CreateTaxRateDto, 
  UpdateTaxRateDto, 
  CreateTaxAgencyDto, 
  CalculateTaxDto,
  FileTaxReturnDto 
} from './dto';

@ApiTags('Sales Tax')
@Controller('organizations/:organizationId/sales-tax')
@UseGuards(SuiteAuthGuard)
@ApiBearerAuth()
export class SalesTaxController {
  constructor(private readonly salesTaxService: SalesTaxService) {}

  // Tax Rates
  @Post('rates')
  @ApiOperation({ summary: 'Create a tax rate' })
  async createTaxRate(
    @Param('organizationId') organizationId: string,
    @Body() input: CreateTaxRateDto,
  ) {
    return this.salesTaxService.createTaxRate(organizationId, {
      ...input,
      effectiveDate: new Date(input.effectiveDate),
      endDate: input.endDate ? new Date(input.endDate) : undefined,
    });
  }

  @Get('rates')
  @ApiOperation({ summary: 'List tax rates' })
  @ApiQuery({ name: 'jurisdiction', required: false })
  @ApiQuery({ name: 'isActive', required: false })
  async getTaxRates(
    @Param('organizationId') organizationId: string,
    @Query('jurisdiction') jurisdiction?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.salesTaxService.getTaxRates(organizationId, {
      jurisdiction,
      isActive: isActive ? isActive === 'true' : undefined,
    });
  }

  @Put('rates/:taxRateId')
  @ApiOperation({ summary: 'Update a tax rate' })
  async updateTaxRate(
    @Param('organizationId') organizationId: string,
    @Param('taxRateId') taxRateId: string,
    @Body() updates: UpdateTaxRateDto,
  ) {
    return this.salesTaxService.updateTaxRate(organizationId, taxRateId, {
      ...updates,
      effectiveDate: updates.effectiveDate ? new Date(updates.effectiveDate) : undefined,
      endDate: updates.endDate ? new Date(updates.endDate) : undefined,
    });
  }

  @Delete('rates/:taxRateId')
  @ApiOperation({ summary: 'Deactivate a tax rate' })
  async deactivateTaxRate(
    @Param('organizationId') organizationId: string,
    @Param('taxRateId') taxRateId: string,
  ) {
    return this.salesTaxService.deactivateTaxRate(organizationId, taxRateId);
  }

  // Tax Agencies
  @Post('agencies')
  @ApiOperation({ summary: 'Create a tax agency' })
  async createTaxAgency(
    @Param('organizationId') organizationId: string,
    @Body() input: CreateTaxAgencyDto,
  ) {
    return this.salesTaxService.createTaxAgency(organizationId, input);
  }

  @Get('agencies')
  @ApiOperation({ summary: 'List tax agencies' })
  async getTaxAgencies(@Param('organizationId') organizationId: string) {
    return this.salesTaxService.getTaxAgencies(organizationId);
  }

  // Tax Calculation
  @Post('calculate')
  @ApiOperation({ summary: 'Calculate tax for a transaction' })
  async calculateTax(
    @Param('organizationId') organizationId: string,
    @Body() request: CalculateTaxDto,
  ) {
    return this.salesTaxService.calculateTax(organizationId, {
      ...request,
      transactionDate: request.transactionDate ? new Date(request.transactionDate) : undefined,
    });
  }

  // Tax Liabilities
  @Get('liabilities')
  @ApiOperation({ summary: 'List tax liabilities' })
  @ApiQuery({ name: 'agencyId', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'year', required: false })
  async getTaxLiabilities(
    @Param('organizationId') organizationId: string,
    @Query('agencyId') agencyId?: string,
    @Query('status') status?: string,
    @Query('year') year?: string,
  ) {
    return this.salesTaxService.getTaxLiabilities(organizationId, {
      agencyId,
      status,
      year: year ? parseInt(year) : undefined,
    });
  }

  @Post('liabilities/:liabilityId/file')
  @ApiOperation({ summary: 'File a tax return' })
  async fileTaxReturn(
    @Param('organizationId') organizationId: string,
    @Param('liabilityId') liabilityId: string,
    @Body() filingData: FileTaxReturnDto,
  ) {
    return this.salesTaxService.fileTaxReturn(organizationId, liabilityId, filingData);
  }

  // Reports
  @Get('summary')
  @ApiOperation({ summary: 'Get tax summary report' })
  @ApiQuery({ name: 'startDate', required: true })
  @ApiQuery({ name: 'endDate', required: true })
  async getTaxSummary(
    @Param('organizationId') organizationId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.salesTaxService.getTaxSummary(
      organizationId,
      new Date(startDate),
      new Date(endDate),
    );
  }
}
