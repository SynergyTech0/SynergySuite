import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { FiscalPeriodService } from './fiscal-period.service';
import {
  CreateFiscalPeriodDto,
  UpdateFiscalPeriodDto,
  GenerateFiscalPeriodsDto,
  FiscalPeriodResponseDto,
  PeriodType,
  PeriodStatus,
} from './dto/fiscal-period.dto';

@ApiTags('fiscal-periods')
@ApiBearerAuth()
@Controller('organizations/:organizationId/fiscal-periods')
export class FiscalPeriodController {
  constructor(private readonly fiscalPeriodService: FiscalPeriodService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new fiscal period' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiResponse({
    status: 201,
    description: 'Fiscal period created successfully',
    type: FiscalPeriodResponseDto,
  })
  async create(
    @Param('organizationId') organizationId: string,
    @Body() dto: CreateFiscalPeriodDto,
  ) {
    return this.fiscalPeriodService.create(organizationId, dto);
  }

  @Post('generate')
  @ApiOperation({ summary: 'Generate fiscal periods for a year' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiResponse({
    status: 201,
    description: 'Fiscal periods generated successfully',
    type: [FiscalPeriodResponseDto],
  })
  async generatePeriods(
    @Param('organizationId') organizationId: string,
    @Body() dto: GenerateFiscalPeriodsDto,
  ) {
    return this.fiscalPeriodService.generatePeriods(organizationId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all fiscal periods' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiQuery({ name: 'fiscalYear', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: PeriodStatus })
  @ApiQuery({ name: 'type', required: false, enum: PeriodType })
  @ApiResponse({
    status: 200,
    description: 'List of fiscal periods',
    type: [FiscalPeriodResponseDto],
  })
  async findAll(
    @Param('organizationId') organizationId: string,
    @Query('fiscalYear') fiscalYear?: string,
    @Query('status') status?: PeriodStatus,
    @Query('type') type?: PeriodType,
  ) {
    return this.fiscalPeriodService.findAll(organizationId, {
      fiscalYear,
      status,
      type,
    });
  }

  @Get('current')
  @ApiOperation({ summary: 'Get current open fiscal period' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiResponse({
    status: 200,
    description: 'Current fiscal period',
    type: FiscalPeriodResponseDto,
  })
  async findCurrentPeriod(@Param('organizationId') organizationId: string) {
    return this.fiscalPeriodService.findCurrentPeriod(organizationId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get fiscal period by ID' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'id', description: 'Fiscal period ID' })
  @ApiResponse({
    status: 200,
    description: 'Fiscal period details',
    type: FiscalPeriodResponseDto,
  })
  async findById(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.fiscalPeriodService.findById(organizationId, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update fiscal period' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'id', description: 'Fiscal period ID' })
  @ApiResponse({
    status: 200,
    description: 'Fiscal period updated successfully',
    type: FiscalPeriodResponseDto,
  })
  async update(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @Body() dto: UpdateFiscalPeriodDto,
  ) {
    return this.fiscalPeriodService.update(organizationId, id, dto);
  }

  @Post(':id/close')
  @ApiOperation({ summary: 'Close fiscal period' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'id', description: 'Fiscal period ID' })
  @ApiResponse({
    status: 200,
    description: 'Fiscal period closed successfully',
    type: FiscalPeriodResponseDto,
  })
  async close(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.fiscalPeriodService.close(organizationId, id);
  }

  @Post(':id/reopen')
  @ApiOperation({ summary: 'Reopen closed fiscal period' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'id', description: 'Fiscal period ID' })
  @ApiResponse({
    status: 200,
    description: 'Fiscal period reopened successfully',
    type: FiscalPeriodResponseDto,
  })
  async reopen(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.fiscalPeriodService.reopen(organizationId, id);
  }

  @Post(':id/lock')
  @ApiOperation({ summary: 'Lock fiscal period (permanent)' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'id', description: 'Fiscal period ID' })
  @ApiResponse({
    status: 200,
    description: 'Fiscal period locked successfully',
    type: FiscalPeriodResponseDto,
  })
  async lock(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.fiscalPeriodService.lock(organizationId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete fiscal period (no entries only)' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'id', description: 'Fiscal period ID' })
  async delete(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    await this.fiscalPeriodService.delete(organizationId, id);
  }
}
