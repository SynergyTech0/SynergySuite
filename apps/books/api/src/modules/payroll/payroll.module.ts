import { Module } from '@nestjs/common';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { TaxCalculator } from './calculators/tax-calculator';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PayrollController],
  providers: [PayrollService, TaxCalculator],
  exports: [PayrollService, TaxCalculator],
})
export class PayrollModule {}
