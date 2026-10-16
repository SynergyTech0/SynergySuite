import { Module } from '@nestjs/common';
import { TaxAdvisorController } from './tax-advisor.controller';
import { TaxAdvisorService } from './tax-advisor.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [TaxAdvisorController],
  providers: [TaxAdvisorService],
  exports: [TaxAdvisorService],
})
export class TaxAdvisorModule {}
