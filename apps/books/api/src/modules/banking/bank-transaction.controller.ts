import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery, ApiParam } from '@nestjs/swagger';
import { BankTransactionService } from './bank-transaction.service';
import {
  CreateBankTransactionDto,
  CategorizeTransactionDto,
  MatchTransactionDto,
  TransactionStatus,
} from './dto/banking.dto';

@ApiTags('bank-transactions')
@ApiBearerAuth()
@Controller('organizations/:organizationId/bank-transactions')
export class BankTransactionController {
  constructor(private readonly bankTransactionService: BankTransactionService) {}

  @Post()
  @ApiOperation({ summary: 'Create a bank transaction' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  async create(
    @Param('organizationId') organizationId: string,
    @Body() dto: CreateBankTransactionDto,
  ) {
    return this.bankTransactionService.create(organizationId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List bank transactions' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiQuery({ name: 'bankAccountId', required: false })
  @ApiQuery({ name: 'status', required: false, enum: TransactionStatus })
  @ApiQuery({ name: 'startDate', required: false, type: Date })
  @ApiQuery({ name: 'endDate', required: false, type: Date })
  @ApiQuery({ name: 'uncategorized', required: false, type: Boolean })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  async findAll(
    @Param('organizationId') organizationId: string,
    @Query('bankAccountId') bankAccountId?: string,
    @Query('status') status?: TransactionStatus,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('uncategorized') uncategorized?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.bankTransactionService.findAll(organizationId, {
      bankAccountId,
      status,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      uncategorized: uncategorized === 'true',
      skip: skip ? parseInt(skip, 10) : undefined,
      take: take ? parseInt(take, 10) : undefined,
    });
  }

  @Get('uncategorized-count')
  @ApiOperation({ summary: 'Get count of uncategorized transactions' })
  @ApiQuery({ name: 'bankAccountId', required: false })
  async getUncategorizedCount(
    @Param('organizationId') organizationId: string,
    @Query('bankAccountId') bankAccountId?: string,
  ) {
    const count = await this.bankTransactionService.getUncategorizedCount(
      organizationId,
      bankAccountId,
    );
    return { count };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get transaction by ID' })
  async findById(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.bankTransactionService.findById(organizationId, id);
  }

  @Get(':id/matches')
  @ApiOperation({ summary: 'Find potential journal matches' })
  async findMatches(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.bankTransactionService.findPotentialMatches(organizationId, id);
  }

  @Post(':id/categorize')
  @ApiOperation({ summary: 'Categorize a transaction' })
  async categorize(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @Body() dto: CategorizeTransactionDto,
  ) {
    return this.bankTransactionService.categorize(organizationId, id, dto);
  }

  @Post(':id/match')
  @ApiOperation({ summary: 'Match to existing journal entry' })
  async match(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @Body() dto: MatchTransactionDto,
  ) {
    return this.bankTransactionService.matchToJournal(
      organizationId,
      id,
      dto.journalEntryId,
    );
  }

  @Post(':id/exclude')
  @ApiOperation({ summary: 'Exclude transaction from accounting' })
  async exclude(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.bankTransactionService.exclude(organizationId, id);
  }
}
