import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BankLinkingController } from './bank-linking.controller';
import { BankLinkingService } from './bank-linking.service';

@Module({
  imports: [PrismaModule],
  controllers: [BankLinkingController],
  providers: [BankLinkingService],
})
export class BankLinkingModule {}
