import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { JournalModule } from '../journal/journal.module';
import { OrganizationModule } from '../organization/organization.module';
import { ConsolidationController } from './consolidation.controller';
import { ConsolidationService } from './consolidation.service';

@Module({
  imports: [PrismaModule, JournalModule, OrganizationModule],
  controllers: [ConsolidationController],
  providers: [ConsolidationService],
})
export class ConsolidationModule {}
