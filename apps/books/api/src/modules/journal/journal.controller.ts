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
import { JournalService } from './journal.service';
import {
  CreateJournalDto,
  UpdateJournalDto,
  PostJournalDto,
  VoidJournalDto,
  ReverseJournalDto,
  JournalSearchDto,
  JournalResponseDto,
  JournalType,
  JournalStatus,
  JournalSource,
} from './dto/journal.dto';

@ApiTags('journals')
@ApiBearerAuth()
@Controller('organizations/:organizationId/journals')
export class JournalController {
  constructor(private readonly journalService: JournalService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new journal entry' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiResponse({
    status: 201,
    description: 'Journal entry created successfully',
    type: JournalResponseDto,
  })
  async create(
    @Param('organizationId') organizationId: string,
    @Body() dto: CreateJournalDto,
  ) {
    return this.journalService.create(organizationId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List journal entries' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiQuery({ name: 'startDate', required: false, type: Date })
  @ApiQuery({ name: 'endDate', required: false, type: Date })
  @ApiQuery({ name: 'type', required: false, enum: JournalType })
  @ApiQuery({ name: 'status', required: false, enum: JournalStatus })
  @ApiQuery({ name: 'source', required: false, enum: JournalSource })
  @ApiQuery({ name: 'accountId', required: false, type: String })
  @ApiQuery({ name: 'fiscalPeriodId', required: false, type: String })
  @ApiQuery({ name: 'search', required: false, type: String })
  async findAll(
    @Param('organizationId') organizationId: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('type') type?: JournalType,
    @Query('status') status?: JournalStatus,
    @Query('source') source?: JournalSource,
    @Query('accountId') accountId?: string,
    @Query('fiscalPeriodId') fiscalPeriodId?: string,
    @Query('search') search?: string,
  ) {
    const searchDto: JournalSearchDto = {
      startDate,
      endDate,
      type,
      status,
      source,
      accountId,
      fiscalPeriodId,
      search,
    };

    return this.journalService.findAll(organizationId, searchDto, {
      skip: skip ? parseInt(skip, 10) : undefined,
      take: take ? parseInt(take, 10) : undefined,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get journal entry by ID' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'id', description: 'Journal entry ID' })
  @ApiResponse({
    status: 200,
    description: 'Journal entry details',
    type: JournalResponseDto,
  })
  async findById(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.journalService.findById(organizationId, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update journal entry (draft only)' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'id', description: 'Journal entry ID' })
  @ApiResponse({
    status: 200,
    description: 'Journal entry updated successfully',
    type: JournalResponseDto,
  })
  async update(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @Body() dto: UpdateJournalDto,
  ) {
    return this.journalService.update(organizationId, id, dto);
  }

  @Post(':id/post')
  @ApiOperation({ summary: 'Post journal entry' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'id', description: 'Journal entry ID' })
  @ApiResponse({
    status: 200,
    description: 'Journal entry posted successfully',
  })
  async post(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @Body() dto: PostJournalDto,
  ) {
    return this.journalService.post(
      organizationId,
      id,
      dto.postDate ? new Date(dto.postDate) : undefined,
    );
  }

  @Post(':id/void')
  @ApiOperation({ summary: 'Void journal entry' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'id', description: 'Journal entry ID' })
  @ApiResponse({
    status: 200,
    description: 'Journal entry voided successfully',
  })
  async void(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @Body() dto: VoidJournalDto,
  ) {
    return this.journalService.void(organizationId, id, dto.reason);
  }

  @Post(':id/reverse')
  @ApiOperation({ summary: 'Create reversal entry' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'id', description: 'Journal entry ID' })
  @ApiResponse({
    status: 201,
    description: 'Reversal entry created successfully',
    type: JournalResponseDto,
  })
  async reverse(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @Body() dto: ReverseJournalDto,
  ) {
    return this.journalService.reverse(
      organizationId,
      id,
      new Date(dto.reversalDate),
      dto.reason,
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete journal entry (draft only)' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'id', description: 'Journal entry ID' })
  async delete(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    await this.journalService.delete(organizationId, id);
  }

  @Get('account/:accountId/ledger')
  @ApiOperation({ summary: 'Get account ledger (general ledger detail)' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'accountId', description: 'Account ID' })
  @ApiQuery({ name: 'startDate', required: false, type: Date })
  @ApiQuery({ name: 'endDate', required: false, type: Date })
  @ApiQuery({ name: 'fiscalPeriodId', required: false, type: String })
  async getAccountLedger(
    @Param('organizationId') organizationId: string,
    @Param('accountId') accountId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('fiscalPeriodId') fiscalPeriodId?: string,
  ) {
    return this.journalService.getAccountLedger(organizationId, accountId, {
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      fiscalPeriodId,
    });
  }
}
