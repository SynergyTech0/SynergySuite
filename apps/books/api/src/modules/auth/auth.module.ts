import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { SuiteAuthGuard } from './guards/suite-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { OrganizationModule } from '../organization/organization.module';

@Global()
@Module({
  imports: [OrganizationModule],
  providers: [
    AuthService,
    SuiteAuthGuard,
    { provide: APP_GUARD, useClass: SuiteAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  controllers: [AuthController],
  exports: [AuthService, SuiteAuthGuard],
})
export class AuthModule {}
