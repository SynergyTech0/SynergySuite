import { Module } from '@nestjs/common';
import { CreditMemoController } from './credit-memo.controller';
import { CreditMemoService } from './credit-memo.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CreditMemoController],
  providers: [CreditMemoService],
  exports: [CreditMemoService],
})
export class CreditMemoModule {}
