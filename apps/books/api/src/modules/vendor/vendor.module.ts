import { Module } from '@nestjs/common';
import { VendorService } from './vendor.service';
import { VendorController } from './vendor.controller';
import { BillService } from './bill.service';
import { BillController } from './bill.controller';
import { JournalModule } from '../journal/journal.module';

@Module({
  imports: [JournalModule],
  providers: [VendorService, BillService],
  controllers: [VendorController, BillController],
  exports: [VendorService, BillService],
})
export class VendorModule {}
