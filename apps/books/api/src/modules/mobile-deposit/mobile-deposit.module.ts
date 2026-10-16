import { Module } from '@nestjs/common';
import { MobileDepositService } from './mobile-deposit.service';
import { MobileDepositController } from './mobile-deposit.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [MobileDepositController],
  providers: [MobileDepositService],
  exports: [MobileDepositService],
})
export class MobileDepositModule {}
