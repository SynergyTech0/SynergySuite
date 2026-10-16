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
  ForbiddenException,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { OrganizationService } from './organization.service';
import { BooksUser, CompaniesService } from './companies.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateOrganizationDto,
  UpdateOrganizationDto,
  OrganizationResponseDto,
} from './dto/organization.dto';

@ApiTags('organizations')
@ApiBearerAuth()
@Controller('organizations')
export class OrganizationController {
  constructor(
    private readonly organizationService: OrganizationService,
    private readonly companies: CompaniesService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new organization' })
  @ApiResponse({
    status: 201,
    description: 'Organization created successfully',
    type: OrganizationResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 409, description: 'Organization with EIN already exists' })
  async create(@Req() req: { user: BooksUser }, @Body() dto: CreateOrganizationDto) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException('Only an admin can add a company.');
    const org = await this.organizationService.create(dto);
    await this.prisma.organizationUser.create({
      data: { organizationId: org.id, userId: req.user.id, role: 'ADMIN', permissions: [] },
    });
    return org;
  }

  @Get()
  @ApiOperation({ summary: 'List all organizations' })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @ApiResponse({
    status: 200,
    description: 'List of organizations',
  })
  async findAll(
    @Req() req: { user: BooksUser },
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('isActive') isActive?: string,
  ) {
    const mine = (await this.companies.list(req.user)).map((c) => c.id);
    return this.organizationService.findAll({
      ids: mine,
      skip: skip ? parseInt(skip, 10) : undefined,
      take: take ? parseInt(take, 10) : undefined,
      isActive: isActive ? isActive === 'true' : undefined,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get organization by ID' })
  @ApiResponse({
    status: 200,
    description: 'Organization details',
    type: OrganizationResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  async findById(@Req() req: { user: BooksUser }, @Param('id') id: string) {
    await this.companies.requireRole(req.user, [id]);
    return this.organizationService.findById(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update organization' })
  @ApiResponse({
    status: 200,
    description: 'Organization updated successfully',
    type: OrganizationResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  @ApiResponse({ status: 409, description: 'Organization with EIN already exists' })
  async update(
    @Req() req: { user: BooksUser },
    @Param('id') id: string,
    @Body() dto: UpdateOrganizationDto,
  ) {
    await this.companies.requireRole(req.user, [id]);
    return this.organizationService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete organization (soft delete)' })
  @ApiResponse({ status: 204, description: 'Organization deleted' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  async delete(@Req() req: { user: BooksUser }, @Param('id') id: string) {
    await this.companies.requireRole(req.user, [id], ['ADMIN']);
    await this.organizationService.delete(id);
  }
}
