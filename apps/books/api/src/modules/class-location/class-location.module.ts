import { Module } from '@nestjs/common';
import { ClassLocationController } from './class-location.controller';
import { ClassLocationService } from './class-location.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ClassLocationController],
  providers: [ClassLocationService],
  exports: [ClassLocationService],
})
export class ClassLocationModule {}
