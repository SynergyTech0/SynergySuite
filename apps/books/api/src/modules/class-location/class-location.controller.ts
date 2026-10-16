import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ClassLocationService } from './class-location.service';
import { SuiteAuthGuard } from '../auth/guards/suite-auth.guard';

@ApiTags('Classes & Locations')
@Controller('organizations/:organizationId')
@UseGuards(SuiteAuthGuard)
@ApiBearerAuth()
export class ClassLocationController {
  constructor(private readonly classLocationService: ClassLocationService) {}

  // Classes
  @Post('classes')
  @ApiOperation({ summary: 'Create class' })
  async createClass(@Param('organizationId') organizationId: string, @Body() data: any) {
    return this.classLocationService.createClass(organizationId, data);
  }

  @Get('classes')
  @ApiOperation({ summary: 'List classes' })
  @ApiQuery({ name: 'includeInactive', required: false })
  @ApiQuery({ name: 'parentClassId', required: false })
  async getClasses(
    @Param('organizationId') organizationId: string,
    @Query('includeInactive') includeInactive?: string,
    @Query('parentClassId') parentClassId?: string,
  ) {
    return this.classLocationService.getClasses(organizationId, {
      includeInactive: includeInactive === 'true',
      parentClassId: parentClassId === 'null' ? null : parentClassId,
    });
  }

  @Get('classes/:classId')
  @ApiOperation({ summary: 'Get class details' })
  async getClass(@Param('organizationId') organizationId: string, @Param('classId') classId: string) {
    return this.classLocationService.getClass(organizationId, classId);
  }

  @Put('classes/:classId')
  @ApiOperation({ summary: 'Update class' })
  async updateClass(
    @Param('organizationId') organizationId: string,
    @Param('classId') classId: string,
    @Body() data: any,
  ) {
    return this.classLocationService.updateClass(organizationId, classId, data);
  }

  @Delete('classes/:classId')
  @ApiOperation({ summary: 'Delete class' })
  async deleteClass(@Param('organizationId') organizationId: string, @Param('classId') classId: string) {
    return this.classLocationService.deleteClass(organizationId, classId);
  }

  // Locations
  @Post('locations')
  @ApiOperation({ summary: 'Create location' })
  async createLocation(@Param('organizationId') organizationId: string, @Body() data: any) {
    return this.classLocationService.createLocation(organizationId, data);
  }

  @Get('locations')
  @ApiOperation({ summary: 'List locations' })
  @ApiQuery({ name: 'includeInactive', required: false })
  @ApiQuery({ name: 'parentLocationId', required: false })
  async getLocations(
    @Param('organizationId') organizationId: string,
    @Query('includeInactive') includeInactive?: string,
    @Query('parentLocationId') parentLocationId?: string,
  ) {
    return this.classLocationService.getLocations(organizationId, {
      includeInactive: includeInactive === 'true',
      parentLocationId: parentLocationId === 'null' ? null : parentLocationId,
    });
  }

  @Get('locations/:locationId')
  @ApiOperation({ summary: 'Get location details' })
  async getLocation(@Param('organizationId') organizationId: string, @Param('locationId') locationId: string) {
    return this.classLocationService.getLocation(organizationId, locationId);
  }

  @Put('locations/:locationId')
  @ApiOperation({ summary: 'Update location' })
  async updateLocation(
    @Param('organizationId') organizationId: string,
    @Param('locationId') locationId: string,
    @Body() data: any,
  ) {
    return this.classLocationService.updateLocation(organizationId, locationId, data);
  }

  @Delete('locations/:locationId')
  @ApiOperation({ summary: 'Delete location' })
  async deleteLocation(@Param('organizationId') organizationId: string, @Param('locationId') locationId: string) {
    return this.classLocationService.deleteLocation(organizationId, locationId);
  }

  // Reporting
  @Get('reports/class-profit-loss')
  @ApiOperation({ summary: 'Get profit & loss by class' })
  async getClassProfitLoss(
    @Param('organizationId') organizationId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.classLocationService.getClassProfitLoss(organizationId, new Date(startDate), new Date(endDate));
  }

  @Get('reports/location-profit-loss')
  @ApiOperation({ summary: 'Get profit & loss by location' })
  async getLocationProfitLoss(
    @Param('organizationId') organizationId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.classLocationService.getLocationProfitLoss(organizationId, new Date(startDate), new Date(endDate));
  }
}
