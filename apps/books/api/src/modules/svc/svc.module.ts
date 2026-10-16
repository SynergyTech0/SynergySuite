import { Module } from '@nestjs/common';
import { SvcController } from './svc.controller';
import { OpsSvcService } from './ops-svc.service';
import { SvcService } from './svc.service';

@Module({
  controllers: [SvcController],
  providers: [SvcService, OpsSvcService],
})
export class SvcModule {}
