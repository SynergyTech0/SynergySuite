import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TransactionCategorizerService } from './transaction-categorizer.service';
import { IncomeStatementService } from './income-statement.service';
import { AutomationOrchestrationService } from './automation-orchestration.service';
import { AutomationController } from './automation.controller';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [AutomationController],
  providers: [
    TransactionCategorizerService,
    IncomeStatementService,
    AutomationOrchestrationService,
  ],
  exports: [
    TransactionCategorizerService,
    IncomeStatementService,
    AutomationOrchestrationService,
  ],
})
export class AutomationModule {}
