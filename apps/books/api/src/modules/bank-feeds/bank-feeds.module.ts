import { Module } from '@nestjs/common';
import { BankFeedsController } from './bank-feeds.controller';
import { BankFeedsService } from './bank-feeds.service';
import { PlaidService } from './providers/plaid.service';
import { YodleeService } from './providers/yodlee.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [BankFeedsController],
  providers: [BankFeedsService, PlaidService, YodleeService],
  exports: [BankFeedsService, PlaidService, YodleeService],
})
export class BankFeedsModule {}
