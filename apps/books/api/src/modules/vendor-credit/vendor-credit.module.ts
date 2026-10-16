import { Module } from '@nestjs/common';
import { VendorCreditController } from './vendor-credit.controller';
import { VendorCreditService } from './vendor-credit.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [VendorCreditController],
  providers: [VendorCreditService],
  exports: [VendorCreditService],
})
export class VendorCreditModule {}
