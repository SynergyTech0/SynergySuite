import {
  Controller,
  Get,
  Post,
  Body,
  Param,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { ReconciliationService } from './reconciliation.service';
import { StartReconciliationDto } from './dto/banking.dto';

@ApiTags('reconciliations')
@ApiBearerAuth()
@Controller('organizations/:organizationId/reconciliations')
export class ReconciliationController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  @Post()
  @ApiOperation({ summary: 'Start a new bank reconciliation' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  async start(
    @Param('organizationId') organizationId: string,
    @Body() dto: StartReconciliationDto,
  ) {
    return this.reconciliationService.start(organizationId, dto);
  }

  @Get('history/:bankAccountId')
  @ApiOperation({ summary: 'Get reconciliation history for account' })
  async getHistory(
    @Param('organizationId') organizationId: string,
    @Param('bankAccountId') bankAccountId: string,
  ) {
    return this.reconciliationService.getHistory(organizationId, bankAccountId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get reconciliation by ID' })
  async findById(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.reconciliationService.findById(organizationId, id);
  }

  @Get(':id/transactions')
  @ApiOperation({ summary: 'Get transactions to reconcile' })
  async getTransactions(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.reconciliationService.getTransactionsToReconcile(organizationId, id);
  }

  @Post(':id/toggle/:transactionId')
  @ApiOperation({ summary: 'Toggle transaction cleared status' })
  async toggleCleared(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @Param('transactionId') transactionId: string,
  ) {
    return this.reconciliationService.toggleTransactionCleared(
      organizationId,
      id,
      transactionId,
    );
  }

  @Post(':id/complete')
  @ApiOperation({ summary: 'Complete reconciliation' })
  async complete(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.reconciliationService.complete(organizationId, id);
  }

  @Post(':id/abandon')
  @ApiOperation({ summary: 'Abandon reconciliation' })
  async abandon(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.reconciliationService.abandon(organizationId, id);
  }
}
