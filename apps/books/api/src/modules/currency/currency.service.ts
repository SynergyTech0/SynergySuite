import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class CurrencyService {
  private readonly logger = new Logger(CurrencyService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createCurrency(code: string, name: string, symbol: string, decimalPlaces: number = 2) {
    const existing = await this.prisma.currency.findUnique({ where: { code } });
    if (existing) {
      throw new BadRequestException('Currency already exists');
    }

    const currency = await this.prisma.currency.create({
      data: {
        id: uuidv4(),
        code,
        name,
        symbol,
        decimalPlaces,
        isActive: true,
      },
    });

    this.logger.log(`Currency ${code} created`);
    return currency;
  }

  async getCurrency(code: string) {
    const currency = await this.prisma.currency.findUnique({
      where: { code },
    });

    if (!currency) {
      throw new NotFoundException('Currency not found');
    }

    return currency;
  }

  async listCurrencies(activeOnly: boolean = true) {
    return this.prisma.currency.findMany({
      where: activeOnly ? { isActive: true } : undefined,
      orderBy: { code: 'asc' },
    });
  }

  async setExchangeRate(fromCurrency: string, toCurrency: string, rate: number, source: string = 'MANUAL') {
    const from = await this.getCurrency(fromCurrency);
    const to = await this.getCurrency(toCurrency);

    const effectiveDate = new Date();
    effectiveDate.setHours(0, 0, 0, 0);

    // Remove old rate for today
    await this.prisma.exchangeRate.deleteMany({
      where: {
        fromCurrency,
        toCurrency,
        effectiveDate,
      },
    });

    const exchangeRate = await this.prisma.exchangeRate.create({
      data: {
        id: uuidv4(),
        fromCurrency,
        toCurrency,
        rate: parseFloat(rate.toFixed(8)),
        effectiveDate,
        source,
      },
    });

    this.logger.log(`Exchange rate ${fromCurrency}/${toCurrency} = ${rate}`);
    return exchangeRate;
  }

  async getExchangeRate(fromCurrency: string, toCurrency: string, date?: Date) {
    if (fromCurrency === toCurrency) {
      return { rate: 1, effectiveDate: new Date() };
    }

    const queryDate = date || new Date();
    queryDate.setHours(0, 0, 0, 0);

    const rate = await this.prisma.exchangeRate.findFirst({
      where: {
        fromCurrency,
        toCurrency,
        effectiveDate: {
          lte: queryDate,
        },
      },
      orderBy: {
        effectiveDate: 'desc',
      },
    });

    if (!rate) {
      throw new BadRequestException(`Exchange rate not found for ${fromCurrency}/${toCurrency}`);
    }

    return rate;
  }

  async convertAmount(amount: number, fromCurrency: string, toCurrency: string, date?: Date): Promise<number> {
    const rate = await this.getExchangeRate(fromCurrency, toCurrency, date);
    return parseFloat((amount * Number(rate.rate)).toFixed(2));
  }

  async getHistoricalRates(fromCurrency: string, toCurrency: string, startDate: Date, endDate: Date) {
    return this.prisma.exchangeRate.findMany({
      where: {
        fromCurrency,
        toCurrency,
        effectiveDate: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { effectiveDate: 'asc' },
    });
  }

  async deactivateCurrency(code: string) {
    return this.prisma.currency.update({
      where: { code },
      data: { isActive: false },
    });
  }
}
