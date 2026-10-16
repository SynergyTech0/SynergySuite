import { Module } from '@nestjs/common';
import { InventoryBundlesService } from './inventory-bundles.service';
import { InventoryBundlesController } from './inventory-bundles.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [InventoryBundlesController],
  providers: [InventoryBundlesService],
  exports: [InventoryBundlesService],
})
export class InventoryBundlesModule {}
