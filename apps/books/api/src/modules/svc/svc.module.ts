import { Module } from '@nestjs/common';
import { JournalModule } from '../journal/journal.module';
import { SvcController } from './svc.controller';
import { SvcService } from './svc.service';

@Module({
  imports: [JournalModule],
  controllers: [SvcController],
  providers: [SvcService],
})
export class SvcModule {}
