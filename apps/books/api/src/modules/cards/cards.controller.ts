import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CardsService } from './cards.service';

@ApiTags('cards')
@ApiBearerAuth()
@Controller('organizations/:organizationId/cards')
export class CardsController {
  constructor(private readonly cardsService: CardsService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Issuing balance, cards, disclosures, posting stats' })
  @ApiParam({ name: 'organizationId' })
  async overview(@Param('organizationId') organizationId: string) {
    return this.cardsService.overview(organizationId);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'Card transaction feed with GL posting status' })
  @ApiParam({ name: 'organizationId' })
  async transactions(@Param('organizationId') organizationId: string) {
    return this.cardsService.transactions(organizationId);
  }

  @Post('transactions/:txnId/categorize')
  @ApiOperation({ summary: 'Post a card transaction to the GL (debit expense, credit clearing)' })
  @ApiParam({ name: 'organizationId' })
  @ApiParam({ name: 'txnId' })
  async categorize(
    @Param('organizationId') organizationId: string,
    @Param('txnId') txnId: string,
    @Body() body: { accountId: string },
    @Req() req: any,
  ) {
    return this.cardsService.categorize(
      organizationId,
      txnId,
      body.accountId,
      req?.user?.id ?? 'system',
    );
  }
}
