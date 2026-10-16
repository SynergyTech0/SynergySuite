import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { JournalService } from './journal.service';
import { JournalController } from './journal.controller';
import { AccountModule } from '../account/account.module';
import { FiscalPeriodModule } from '../fiscal-period/fiscal-period.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'tax-classification',
    }),
    AccountModule,
    FiscalPeriodModule,
  ],
  providers: [JournalService],
  controllers: [JournalController],
  exports: [JournalService],
})
export class JournalModule {}
