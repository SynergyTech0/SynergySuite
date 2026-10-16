import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { BankAccountService } from './bank-account.service';
import { BankAccountController } from './bank-account.controller';
import { BankTransactionService } from './bank-transaction.service';
import { BankTransactionController } from './bank-transaction.controller';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationController } from './reconciliation.controller';
import { JournalModule } from '../journal/journal.module';
import { AccountModule } from '../account/account.module';
import { TaxClassificationModule } from '../tax-classification/tax-classification.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'bank-classification',
    }),
    JournalModule,
    AccountModule,
    TaxClassificationModule,
  ],
  providers: [BankAccountService, BankTransactionService, ReconciliationService],
  controllers: [
    BankAccountController,
    BankTransactionController,
    ReconciliationController,
  ],
  exports: [BankAccountService, BankTransactionService, ReconciliationService],
})
export class BankingModule {}
