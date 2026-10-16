import { Module } from '@nestjs/common';
import { CustomerModule } from '../customer/customer.module';
import { JournalModule } from '../journal/journal.module';
import { SvcController } from './svc.controller';
import { SvcService } from './svc.service';

@Module({
  imports: [CustomerModule, JournalModule],
  controllers: [SvcController],
  providers: [SvcService],
})
export class SvcModule {}
