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
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery, ApiParam } from '@nestjs/swagger';
import { VendorService } from './vendor.service';
import { CreateVendorDto, UpdateVendorDto } from './dto/vendor.dto';

@ApiTags('vendors')
@ApiBearerAuth()
@Controller('organizations/:organizationId/vendors')
export class VendorController {
  constructor(private readonly vendorService: VendorService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new vendor' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  async create(
    @Param('organizationId') organizationId: string,
    @Body() dto: CreateVendorDto,
  ) {
    return this.vendorService.create(organizationId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all vendors' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @ApiQuery({ name: 'is1099', required: false, type: Boolean })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  async findAll(
    @Param('organizationId') organizationId: string,
    @Query('search') search?: string,
    @Query('isActive') isActive?: string,
    @Query('is1099') is1099?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.vendorService.findAll(organizationId, {
      search,
      isActive: isActive ? isActive === 'true' : undefined,
      is1099: is1099 ? is1099 === 'true' : undefined,
      skip: skip ? parseInt(skip, 10) : undefined,
      take: take ? parseInt(take, 10) : undefined,
    });
  }

  @Get('1099-report/:year')
  @ApiOperation({ summary: 'Get 1099 report for tax year' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'year', description: 'Tax year' })
  async get1099Report(
    @Param('organizationId') organizationId: string,
    @Param('year') year: string,
  ) {
    return this.vendorService.get1099Report(organizationId, parseInt(year, 10));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get vendor by ID' })
  async findById(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.vendorService.findById(organizationId, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update vendor' })
  async update(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @Body() dto: UpdateVendorDto,
  ) {
    return this.vendorService.update(organizationId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete vendor' })
  async delete(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    await this.vendorService.delete(organizationId, id);
  }
}
