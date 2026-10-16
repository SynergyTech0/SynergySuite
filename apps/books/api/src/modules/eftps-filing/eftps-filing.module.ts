import { Module } from '@nestjs/common';
import { EFTPSFilingService } from './eftps-filing.service';
import { EFTPSFilingController } from './eftps-filing.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [EFTPSFilingController],
  providers: [EFTPSFilingService],
  exports: [EFTPSFilingService],
})
export class EFTPSFilingModule {}
