import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { SuiteAuthGuard } from '../auth/guards/suite-auth.guard';
import {
  MobileDepositService,
  CreateMobileDepositDto,
  ReviewDepositDto,
} from './mobile-deposit.service';

@Controller('mobile-deposits')
@UseGuards(SuiteAuthGuard)
export class MobileDepositController {
  constructor(private readonly depositService: MobileDepositService) {}

  @Post()
  async createDeposit(@Request() req: any, @Body() dto: CreateMobileDepositDto) {
    return this.depositService.createDeposit(req.user.organizationId, dto, req.user.id);
  }

  @Get()
  async getDeposits(
    @Request() req: any,
    @Query('bankAccountId') bankAccountId?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.depositService.getDeposits(req.user.organizationId, {
      bankAccountId,
      status,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get('stats')
  async getDepositStats(
    @Request() req: any,
    @Query('bankAccountId') bankAccountId?: string,
  ) {
    return this.depositService.getDepositStats(req.user.organizationId, bankAccountId);
  }

  @Get(':id')
  async getDeposit(@Request() req: any, @Param('id') id: string) {
    return this.depositService.getDeposit(req.user.organizationId, id);
  }

  @Post(':id/review')
  async reviewDeposit(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: ReviewDepositDto,
  ) {
    return this.depositService.reviewDeposit(
      req.user.organizationId,
      id,
      dto,
      req.user.id,
    );
  }

  @Post(':id/clear')
  async clearDeposit(@Request() req: any, @Param('id') id: string) {
    return this.depositService.clearDeposit(req.user.organizationId, id);
  }

  @Post(':id/return')
  async returnDeposit(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { returnCode: string; returnReason: string },
  ) {
    return this.depositService.returnDeposit(
      req.user.organizationId,
      id,
      body.returnCode,
      body.returnReason,
    );
  }

  @Post('check-duplicates')
  async checkForDuplicates(
    @Request() req: any,
    @Body() body: { amount: number; checkNumber?: string; micr?: string },
  ) {
    return this.depositService.checkForDuplicates(
      req.user.organizationId,
      body.amount,
      body.checkNumber,
      body.micr,
    );
  }
}
