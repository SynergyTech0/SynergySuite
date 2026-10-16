import { Module } from '@nestjs/common';
import { CheckPrintingService } from './check-printing.service';
import { CheckPrintingController } from './check-printing.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CheckPrintingController],
  providers: [CheckPrintingService],
  exports: [CheckPrintingService],
})
export class CheckPrintingModule {}
