import { Module } from '@nestjs/common';
import { SvcController } from './svc.controller';
import { SvcService } from './svc.service';

@Module({
  controllers: [SvcController],
  providers: [SvcService],
})
export class SvcModule {}
