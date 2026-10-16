import { Controller, Post, Body, Param, Req, UseGuards } from '@nestjs/common';
import { IsString } from 'class-validator';
import type { Request } from 'express';
import { SuiteAuthGuard } from '../auth/guards/suite-auth.guard';
import { BankLinkingService } from './bank-linking.service';

/** The request after SuiteAuthGuard has attached the signed-in Books user. */
type AuthenticatedRequest = Request & { user?: { email?: string | null } };

class CompleteLinkDto {
  @IsString() sessionId: string;
  @IsString() ref: string;
  @IsString() glAccountId: string;
}

@Controller('organizations/:organizationId/bank-link')
@UseGuards(SuiteAuthGuard)
export class BankLinkingController {
  constructor(private readonly service: BankLinkingService) {}

  @Post('session')
  async session(@Param('organizationId') organizationId: string, @Req() req: AuthenticatedRequest) {
    const email = req.user?.email ?? undefined;
    return this.service.createSession(organizationId, email);
  }

  @Post('complete')
  async complete(@Param('organizationId') organizationId: string, @Body() dto: CompleteLinkDto) {
    return this.service.complete(organizationId, dto.sessionId, dto.ref, dto.glAccountId);
  }

  @Post(':bankAccountId/sync')
  async sync(@Param('organizationId') organizationId: string, @Param('bankAccountId') bankAccountId: string) {
    return this.service.sync(organizationId, bankAccountId);
  }
}
