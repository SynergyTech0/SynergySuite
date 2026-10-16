import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CurrencyService } from './currency.service';

@ApiTags('currencies')
@ApiBearerAuth()
@Controller('currencies')
export class CurrencyController {
  constructor(private readonly currencyService: CurrencyService) {}

  @Post()
  @ApiOperation({ summary: 'Create a currency' })
  async createCurrency(
    @Body() body: { code: string; name: string; symbol: string; decimalPlaces?: number },
  ) {
    return this.currencyService.createCurrency(body.code, body.name, body.symbol, body.decimalPlaces);
  }

  @Get(':code')
  @ApiOperation({ summary: 'Get a currency' })
  async getCurrency(@Param('code') code: string) {
    return this.currencyService.getCurrency(code);
  }

  @Get()
  @ApiOperation({ summary: 'List currencies' })
  async listCurrencies(@Query('activeOnly') activeOnly: string = 'true') {
    return this.currencyService.listCurrencies(activeOnly === 'true');
  }

  @Post('exchange-rate')
  @ApiOperation({ summary: 'Set exchange rate' })
  async setExchangeRate(
    @Body() body: { fromCurrency: string; toCurrency: string; rate: number; source?: string },
  ) {
    return this.currencyService.setExchangeRate(body.fromCurrency, body.toCurrency, body.rate, body.source);
  }

  @Get('exchange-rate/:fromCurrency/:toCurrency')
  @ApiOperation({ summary: 'Get exchange rate' })
  async getExchangeRate(
    @Param('fromCurrency') fromCurrency: string,
    @Param('toCurrency') toCurrency: string,
    @Query('date') date?: string,
  ) {
    return this.currencyService.getExchangeRate(fromCurrency, toCurrency, date ? new Date(date) : undefined);
  }

  @Post('convert')
  @ApiOperation({ summary: 'Convert amount' })
  async convertAmount(
    @Body() body: { amount: number; fromCurrency: string; toCurrency: string; date?: string },
  ) {
    const result = await this.currencyService.convertAmount(
      body.amount,
      body.fromCurrency,
      body.toCurrency,
      body.date ? new Date(body.date) : undefined,
    );

    return {
      originalAmount: body.amount,
      originalCurrency: body.fromCurrency,
      convertedAmount: result,
      targetCurrency: body.toCurrency,
    };
  }

  @Get('historical-rates/:fromCurrency/:toCurrency')
  @ApiOperation({ summary: 'Get historical rates' })
  async getHistoricalRates(
    @Param('fromCurrency') fromCurrency: string,
    @Param('toCurrency') toCurrency: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.currencyService.getHistoricalRates(
      fromCurrency,
      toCurrency,
      new Date(startDate),
      new Date(endDate),
    );
  }

  @Post(':code/deactivate')
  @ApiOperation({ summary: 'Deactivate currency' })
  async deactivateCurrency(@Param('code') code: string) {
    return this.currencyService.deactivateCurrency(code);
  }
}
