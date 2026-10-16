import { Module } from '@nestjs/common';
import { CustomerService } from './customer.service';
import { CustomerController } from './customer.controller';
import { InvoiceService } from './invoice.service';
import { InvoiceController } from './invoice.controller';
import { StripeCollectService } from './stripe-collect.service';
import { JournalModule } from '../journal/journal.module';

@Module({
  imports: [JournalModule],
  providers: [CustomerService, InvoiceService, StripeCollectService],
  controllers: [CustomerController, InvoiceController],
  exports: [CustomerService, InvoiceService],
})
export class CustomerModule {}
