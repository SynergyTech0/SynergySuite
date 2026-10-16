import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BooksUser, CompaniesService } from './companies.service';
import { EntityType } from './dto/organization.dto';

type Req = { user: BooksUser };

@ApiTags('companies')
@ApiBearerAuth()
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get()
  @ApiOperation({ summary: 'Companies you belong to' })
  list(@Req() req: Req) {
    return this.companies.list(req.user);
  }

  @Post()
  @ApiOperation({ summary: 'Add a company (admins)' })
  create(
    @Req() req: Req,
    @Body() body: { name: string; defaultCurrency?: string; fiscalYearEnd?: number; entityType?: EntityType; legalName?: string },
  ) {
    return this.companies.create(req.user, body);
  }

  @Post(':companyId/switch')
  @ApiOperation({ summary: 'Work in another of your companies' })
  switchTo(@Req() req: Req, @Param('companyId') companyId: string) {
    return this.companies.switchTo(req.user, companyId);
  }

  @Get(':companyId/members')
  @ApiOperation({ summary: "A company's members and their roles" })
  members(@Req() req: Req, @Param('companyId') companyId: string) {
    return this.companies.members(req.user, companyId);
  }

  @Post(':companyId/members')
  @ApiOperation({ summary: 'Give someone access to a company (admins)' })
  addMember(@Req() req: Req, @Param('companyId') companyId: string, @Body() body: { email: string; role?: string }) {
    return this.companies.addMember(req.user, companyId, body);
  }

  @Delete(':companyId/members/:userId')
  @ApiOperation({ summary: "Remove someone's access to a company (admins)" })
  removeMember(@Req() req: Req, @Param('companyId') companyId: string, @Param('userId') userId: string) {
    return this.companies.removeMember(req.user, companyId, userId);
  }
}
