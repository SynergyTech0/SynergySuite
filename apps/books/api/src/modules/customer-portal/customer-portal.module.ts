import { Module } from '@nestjs/common';
import { CustomerPortalController, CustomerPortalPublicController } from './customer-portal.controller';
import { CustomerPortalService } from './customer-portal.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CustomerPortalController, CustomerPortalPublicController],
  providers: [CustomerPortalService],
  exports: [CustomerPortalService],
})
export class CustomerPortalModule {}
