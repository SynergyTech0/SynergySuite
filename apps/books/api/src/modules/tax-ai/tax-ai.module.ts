import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TaxAiController } from './tax-ai.controller';
import { TaxAiService } from './tax-ai.service';

@Module({
  imports: [PrismaModule],
  controllers: [TaxAiController],
  providers: [TaxAiService],
})
export class TaxAiModule {}
