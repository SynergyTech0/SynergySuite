import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BankFeedsService, BankFeedConfig } from './bank-feeds.service';
import { SuiteAuthGuard } from '../auth/guards/suite-auth.guard';

@ApiTags('Bank Feeds')
@Controller('organizations/:organizationId/bank-feeds')
@UseGuards(SuiteAuthGuard)
@ApiBearerAuth()
export class BankFeedsController {
  constructor(private readonly bankFeedsService: BankFeedsService) {}

  @Post('connections')
  @ApiOperation({ summary: 'Create bank feed connection' })
  async createConnection(
    @Param('organizationId') organizationId: string,
    @Body() body: { bankAccountId: string; config: BankFeedConfig },
  ) {
    return this.bankFeedsService.createConnection(organizationId, body.bankAccountId, body.config);
  }

  @Get('connections')
  @ApiOperation({ summary: 'List bank feed connections' })
  async getConnections(@Param('organizationId') organizationId: string) {
    return this.bankFeedsService.getConnections(organizationId);
  }

  @Post('connections/:connectionId/sync')
  @ApiOperation({ summary: 'Sync transactions from bank' })
  async syncTransactions(@Param('connectionId') connectionId: string) {
    return this.bankFeedsService.syncTransactions(connectionId);
  }

  @Post('rules')
  @ApiOperation({ summary: 'Create bank feed rule' })
  async createRule(
    @Param('organizationId') organizationId: string,
    @Body() rule: any,
  ) {
    return this.bankFeedsService.createRule(organizationId, rule);
  }

  @Get('rules')
  @ApiOperation({ summary: 'List bank feed rules' })
  async getRules(@Param('organizationId') organizationId: string) {
    return this.bankFeedsService.getRules(organizationId);
  }

  @Get('unmatched')
  @ApiOperation({ summary: 'Get unmatched transactions' })
  async getUnmatchedTransactions(
    @Param('organizationId') organizationId: string,
    @Query('bankAccountId') bankAccountId?: string,
  ) {
    return this.bankFeedsService.getUnmatchedTransactions(organizationId, bankAccountId);
  }

  @Post('transactions/:transactionId/apply-rules')
  @ApiOperation({ summary: 'Apply rules to transaction' })
  async applyRules(
    @Param('organizationId') organizationId: string,
    @Param('transactionId') transactionId: string,
  ) {
    return this.bankFeedsService.applyRules(organizationId, transactionId);
  }

  @Post('transactions/:transactionId/match')
  @ApiOperation({ summary: 'Match transaction to journal entry' })
  async matchTransaction(
    @Param('transactionId') transactionId: string,
    @Body() body: { journalId: string; matchMethod: 'EXACT_MATCH' | 'FUZZY_MATCH' | 'MANUAL'; confidence?: number },
  ) {
    return this.bankFeedsService.matchTransaction(transactionId, body.journalId, body.matchMethod, body.confidence);
  }
}
