import { Module } from '@nestjs/common';
import { OpsLinkController } from './ops-link.controller';
import { OpsLinkService } from './ops-link.service';

@Module({
  controllers: [OpsLinkController],
  providers: [OpsLinkService],
})
export class OpsLinkModule {}
