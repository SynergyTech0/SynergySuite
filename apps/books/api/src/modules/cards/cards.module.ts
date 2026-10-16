import { Module } from '@nestjs/common';
import { CardsService } from './cards.service';
import { CardsController } from './cards.controller';
import { JournalModule } from '../journal/journal.module';

@Module({
  imports: [JournalModule],
  providers: [CardsService],
  controllers: [CardsController],
})
export class CardsModule {}
