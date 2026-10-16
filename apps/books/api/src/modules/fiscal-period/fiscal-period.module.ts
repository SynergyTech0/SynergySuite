import { Module } from '@nestjs/common';
import { FiscalPeriodService } from './fiscal-period.service';
import { FiscalPeriodController } from './fiscal-period.controller';

@Module({
  providers: [FiscalPeriodService],
  controllers: [FiscalPeriodController],
  exports: [FiscalPeriodService],
})
export class FiscalPeriodModule {}
