import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { AccountService } from './account.service';
import {
  CreateAccountDto,
  UpdateAccountDto,
  AccountResponseDto,
  AccountBalanceDto,
  AccountType,
} from './dto/account.dto';

@ApiTags('accounts')
@ApiBearerAuth()
@Controller('organizations/:organizationId/accounts')
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new account' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiResponse({
    status: 201,
    description: 'Account created successfully',
    type: AccountResponseDto,
  })
  async create(
    @Param('organizationId') organizationId: string,
    @Body() dto: CreateAccountDto,
  ) {
    return this.accountService.create(organizationId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all accounts for an organization' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiQuery({ name: 'type', required: false, enum: AccountType })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @ApiQuery({ name: 'parentId', required: false, type: String })
  @ApiQuery({ name: 'search', required: false, type: String })
  async findAll(
    @Param('organizationId') organizationId: string,
    @Query('type') type?: AccountType,
    @Query('isActive') isActive?: string,
    @Query('parentId') parentId?: string,
    @Query('search') search?: string,
  ) {
    return this.accountService.findAll(organizationId, {
      type,
      isActive: isActive ? isActive === 'true' : undefined,
      parentId: parentId === 'null' ? null : parentId,
      search,
    });
  }

  @Get('chart')
  @ApiOperation({ summary: 'Get hierarchical chart of accounts' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  async getChartOfAccounts(@Param('organizationId') organizationId: string) {
    return this.accountService.getChartOfAccounts(organizationId);
  }

  @Get('trial-balance')
  @ApiOperation({ summary: 'Get trial balance' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiQuery({ name: 'asOfDate', required: false, type: Date })
  @ApiQuery({ name: 'fiscalPeriodId', required: false, type: String })
  async getTrialBalance(
    @Param('organizationId') organizationId: string,
    @Query('asOfDate') asOfDate?: string,
    @Query('fiscalPeriodId') fiscalPeriodId?: string,
  ) {
    return this.accountService.getTrialBalance(organizationId, {
      asOfDate: asOfDate ? new Date(asOfDate) : undefined,
      fiscalPeriodId,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get account by ID' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'id', description: 'Account ID' })
  @ApiResponse({
    status: 200,
    description: 'Account details',
    type: AccountResponseDto,
  })
  async findById(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.accountService.findById(organizationId, id);
  }

  @Get('code/:code')
  @ApiOperation({ summary: 'Get account by code' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'code', description: 'Account code' })
  async findByCode(
    @Param('organizationId') organizationId: string,
    @Param('code') code: string,
  ) {
    return this.accountService.findByCode(organizationId, code);
  }

  @Get(':id/balance')
  @ApiOperation({ summary: 'Get account balance' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'id', description: 'Account ID' })
  @ApiQuery({ name: 'asOfDate', required: false, type: Date })
  @ApiQuery({ name: 'fiscalPeriodId', required: false, type: String })
  @ApiResponse({
    status: 200,
    description: 'Account balance',
    type: AccountBalanceDto,
  })
  async getBalance(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @Query('asOfDate') asOfDate?: string,
    @Query('fiscalPeriodId') fiscalPeriodId?: string,
  ) {
    return this.accountService.getBalance(organizationId, id, {
      asOfDate: asOfDate ? new Date(asOfDate) : undefined,
      fiscalPeriodId,
    });
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update account' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'id', description: 'Account ID' })
  @ApiResponse({
    status: 200,
    description: 'Account updated successfully',
    type: AccountResponseDto,
  })
  async update(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAccountDto,
  ) {
    return this.accountService.update(organizationId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete account' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'id', description: 'Account ID' })
  async delete(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    await this.accountService.delete(organizationId, id);
  }
}
