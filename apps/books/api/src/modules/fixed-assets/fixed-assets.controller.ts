import { Controller, Get, Post, Put, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { FixedAssetsService } from './fixed-assets.service';
import { SuiteAuthGuard } from '../auth/guards/suite-auth.guard';
import { 
  CreateAssetDto, 
  UpdateAssetDto, 
  CalculateDepreciationDto, 
  RunMonthlyDepreciationDto,
  DisposeAssetDto 
} from './dto';

@ApiTags('Fixed Assets')
@Controller('organizations/:organizationId/fixed-assets')
@UseGuards(SuiteAuthGuard)
@ApiBearerAuth()
export class FixedAssetsController {
  constructor(private readonly fixedAssetsService: FixedAssetsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a fixed asset' })
  async createAsset(
    @Param('organizationId') organizationId: string,
    @Body() input: CreateAssetDto,
  ) {
    return this.fixedAssetsService.createAsset(organizationId, {
      ...input,
      acquisitionDate: new Date(input.acquisitionDate),
    });
  }

  @Put(':assetId')
  @ApiOperation({ summary: 'Update asset details' })
  async updateAsset(
    @Param('organizationId') organizationId: string,
    @Param('assetId') assetId: string,
    @Body() updates: UpdateAssetDto,
  ) {
    return this.fixedAssetsService.updateAsset(organizationId, assetId, updates);
  }

  @Get()
  @ApiOperation({ summary: 'List fixed assets' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'assetType', required: false })
  async getAssets(
    @Param('organizationId') organizationId: string,
    @Query('status') status?: string,
    @Query('assetType') assetType?: string,
  ) {
    return this.fixedAssetsService.getAssets(organizationId, { status, assetType });
  }

  @Get(':assetId')
  @ApiOperation({ summary: 'Get asset details' })
  async getAsset(
    @Param('organizationId') organizationId: string,
    @Param('assetId') assetId: string,
  ) {
    return this.fixedAssetsService.getAsset(organizationId, assetId);
  }

  @Get(':assetId/schedule')
  @ApiOperation({ summary: 'Get depreciation schedule' })
  async getDepreciationSchedule(
    @Param('organizationId') organizationId: string,
    @Param('assetId') assetId: string,
  ) {
    return this.fixedAssetsService.getDepreciationSchedule(organizationId, assetId);
  }

  @Post(':assetId/depreciate')
  @ApiOperation({ summary: 'Calculate depreciation for period' })
  async calculateDepreciation(
    @Param('organizationId') organizationId: string,
    @Param('assetId') assetId: string,
    @Body() body: CalculateDepreciationDto,
  ) {
    return this.fixedAssetsService.calculateDepreciation(organizationId, assetId, new Date(body.periodDate));
  }

  @Post('run-monthly')
  @ApiOperation({ summary: 'Run monthly depreciation for all assets' })
  async runMonthlyDepreciation(
    @Param('organizationId') organizationId: string,
    @Body() body: RunMonthlyDepreciationDto,
  ) {
    return this.fixedAssetsService.runMonthlyDepreciation(organizationId, new Date(body.periodDate));
  }

  @Post(':assetId/dispose')
  @ApiOperation({ summary: 'Dispose of an asset' })
  async disposeAsset(
    @Param('organizationId') organizationId: string,
    @Param('assetId') assetId: string,
    @Body() disposal: DisposeAssetDto,
  ) {
    return this.fixedAssetsService.disposeAsset(organizationId, assetId, {
      ...disposal,
      disposalDate: new Date(disposal.disposalDate),
    });
  }

  @Get('reports/summary')
  @ApiOperation({ summary: 'Get asset summary report' })
  async getAssetSummary(@Param('organizationId') organizationId: string) {
    return this.fixedAssetsService.getAssetSummary(organizationId);
  }

  @Get('reports/depreciation-forecast')
  @ApiOperation({ summary: 'Get depreciation forecast' })
  @ApiQuery({ name: 'months', required: false })
  async getDepreciationForecast(
    @Param('organizationId') organizationId: string,
    @Query('months') months?: string,
  ) {
    return this.fixedAssetsService.getDepreciationForecast(
      organizationId,
      months ? parseInt(months) : 12,
    );
  }
}
