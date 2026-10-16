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
import { InventoryBundlesService, CreateBundleDto, BuildAssemblyDto } from './inventory-bundles.service';

@Controller('inventory/bundles')
@UseGuards(SuiteAuthGuard)
export class InventoryBundlesController {
  constructor(private readonly bundlesService: InventoryBundlesService) {}

  @Post()
  async createBundle(@Request() req: any, @Body() dto: CreateBundleDto) {
    return this.bundlesService.createBundle(req.user.organizationId, dto);
  }

  @Get()
  async listBundles(
    @Request() req: any,
    @Query('bundleType') bundleType?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.bundlesService.listBundles(req.user.organizationId, {
      bundleType,
      isActive: isActive ? isActive === 'true' : undefined,
    });
  }

  @Get(':id')
  async getBundle(@Request() req: any, @Param('id') id: string) {
    return this.bundlesService.getBundle(req.user.organizationId, id);
  }

  @Put(':id')
  async updateBundle(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: Partial<CreateBundleDto>,
  ) {
    return this.bundlesService.updateBundle(req.user.organizationId, id, dto);
  }

  @Delete(':id')
  async deactivateBundle(@Request() req: any, @Param('id') id: string) {
    return this.bundlesService.deactivateBundle(req.user.organizationId, id);
  }

  // Assembly Building
  @Post('build')
  async buildAssembly(@Request() req: any, @Body() dto: BuildAssemblyDto) {
    return this.bundlesService.buildAssembly(req.user.organizationId, dto, req.user.id);
  }

  @Get('builds/history')
  async getAssemblyBuilds(
    @Request() req: any,
    @Query('bundleId') bundleId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.bundlesService.getAssemblyBuilds(req.user.organizationId, {
      bundleId,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  // Bundle Sales
  @Post(':id/sell')
  async sellBundle(
    @Request() req: any,
    @Param('id') id: string,
    @Body('quantity') quantity: number,
    @Body('referenceId') referenceId: string,
  ) {
    return this.bundlesService.sellBundle(req.user.organizationId, id, quantity, referenceId);
  }
}
