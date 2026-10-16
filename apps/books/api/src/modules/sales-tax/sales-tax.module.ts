import { Module } from '@nestjs/common';
import { SalesTaxController } from './sales-tax.controller';
import { SalesTaxService } from './sales-tax.service';
import { SalesTaxIntegrationService } from './sales-tax-integration.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [SalesTaxController],
  providers: [SalesTaxService, SalesTaxIntegrationService],
  exports: [SalesTaxService, SalesTaxIntegrationService],
})
export class SalesTaxModule {}
