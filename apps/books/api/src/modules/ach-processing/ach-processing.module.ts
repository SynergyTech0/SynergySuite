import { Module } from '@nestjs/common';
import { ACHProcessingService } from './ach-processing.service';
import { ACHProcessingController } from './ach-processing.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ACHProcessingController],
  providers: [ACHProcessingService],
  exports: [ACHProcessingService],
})
export class ACHProcessingModule {}
