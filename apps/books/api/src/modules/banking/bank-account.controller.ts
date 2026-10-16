import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery, ApiParam } from '@nestjs/swagger';
import { BankAccountService } from './bank-account.service';
import { CreateBankAccountDto, UpdateBankAccountDto } from './dto/banking.dto';

@ApiTags('bank-accounts')
@ApiBearerAuth()
@Controller('organizations/:organizationId/bank-accounts')
export class BankAccountController {
  constructor(private readonly bankAccountService: BankAccountService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new bank account' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  async create(
    @Param('organizationId') organizationId: string,
    @Body() dto: CreateBankAccountDto,
  ) {
    return this.bankAccountService.create(organizationId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all bank accounts' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  async findAll(
    @Param('organizationId') organizationId: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.bankAccountService.findAll(organizationId, {
      isActive: isActive ? isActive === 'true' : undefined,
    });
  }

  @Get('summary')
  @ApiOperation({ summary: 'Get cash summary across all accounts' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  async getSummary(@Param('organizationId') organizationId: string) {
    return this.bankAccountService.getAccountSummary(organizationId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get bank account by ID' })
  async findById(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.bankAccountService.findById(organizationId, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update bank account' })
  async update(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @Body() dto: UpdateBankAccountDto,
  ) {
    return this.bankAccountService.update(organizationId, id, dto);
  }
}
