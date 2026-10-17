import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BooksUser } from '../organization/companies.service';
import { ConsolidationService } from './consolidation.service';
import { CreateGroupDto, CreateIntercompanyDto, SetRateDto, UpdateGroupDto } from './consolidation.dto';

type Req = { user: BooksUser };

@ApiTags('consolidation')
@ApiBearerAuth()
@Controller('consolidation')
export class ConsolidationController {
  constructor(private readonly consolidation: ConsolidationService) {}

  @Get('groups')
  @ApiOperation({ summary: 'Consolidation groups you can see' })
  listGroups(@Req() req: Req) {
    return this.consolidation.listGroups(req.user);
  }

  @Post('groups')
  @ApiOperation({ summary: 'Create a consolidation group' })
  createGroup(@Req() req: Req, @Body() dto: CreateGroupDto) {
    return this.consolidation.createGroup(req.user, dto);
  }

  @Get('groups/:id')
  getGroup(@Req() req: Req, @Param('id') id: string) {
    return this.consolidation.getGroup(req.user, id);
  }

  @Put('groups/:id')
  updateGroup(@Req() req: Req, @Param('id') id: string, @Body() dto: UpdateGroupDto) {
    return this.consolidation.updateGroup(req.user, id, dto);
  }

  @Delete('groups/:id')
  deleteGroup(@Req() req: Req, @Param('id') id: string) {
    return this.consolidation.deleteGroup(req.user, id);
  }

  @Get('groups/:id/report')
  @ApiOperation({ summary: 'Consolidated income statement and balance sheet with eliminations' })
  report(@Req() req: Req, @Param('id') id: string, @Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
    return this.consolidation.report(req.user, id, startDate, endDate);
  }

  @Get('intercompany')
  @ApiOperation({ summary: 'Intercompany entries in your companies' })
  listIntercompany(@Req() req: Req, @Query('organizationId') organizationId?: string) {
    return this.consolidation.listIntercompany(req.user, organizationId);
  }

  @Post('intercompany')
  @ApiOperation({ summary: 'Record an intercompany charge, loan or settlement in both companies' })
  createIntercompany(@Req() req: Req, @Body() dto: CreateIntercompanyDto) {
    return this.consolidation.createIntercompany(req.user, dto);
  }

  @Post('intercompany/:id/void')
  @ApiOperation({ summary: 'Void both journals of an intercompany entry' })
  voidIntercompany(@Req() req: Req, @Param('id') id: string) {
    return this.consolidation.voidIntercompany(req.user, id);
  }

  @Get('accounts')
  @ApiOperation({ summary: "Accounts of one of your companies, for intercompany entries" })
  accounts(@Req() req: Req, @Query('organizationId') organizationId: string) {
    return this.consolidation.accounts(req.user, organizationId);
  }

  @Get('rates')
  @ApiOperation({ summary: 'Exchange rates' })
  listRates() {
    return this.consolidation.listRates();
  }

  @Post('rates')
  @ApiOperation({ summary: 'Set an exchange rate for a day' })
  setRate(@Req() req: Req, @Body() dto: SetRateDto) {
    return this.consolidation.setRate(req.user, dto);
  }
}
