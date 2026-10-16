import { Module } from '@nestjs/common';
import { OrganizationService } from './organization.service';
import { OrganizationController } from './organization.controller';
import { CompaniesService } from './companies.service';
import { CompaniesController } from './companies.controller';

@Module({
  providers: [OrganizationService, CompaniesService],
  controllers: [OrganizationController, CompaniesController],
  exports: [OrganizationService, CompaniesService],
})
export class OrganizationModule {}
