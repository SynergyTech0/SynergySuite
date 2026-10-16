import { Module } from '@nestjs/common';
import { ReportExportsController } from './report-exports.controller';
import { ReportExportsService } from './report-exports.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ReportExportsController],
  providers: [ReportExportsService],
  exports: [ReportExportsService],
})
export class ReportExportsModule {}
