import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateOrganizationDto, UpdateOrganizationDto } from './dto/organization.dto';
import { v4 as uuidv4 } from 'uuid';
import { AccountType, NormalBalance, Prisma } from '@prisma/client';

/** A row of the default chart of accounts; parentCode refers to another row's code. */
type DefaultAccount = {
  code: string;
  name: string;
  type: AccountType;
  subType: string;
  normalBalance: NormalBalance;
  parentCode?: string;
};

@Injectable()
export class OrganizationService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateOrganizationDto) {
    // Check for duplicate EIN if provided
    if (dto.ein) {
      const existing = await this.prisma.organization.findFirst({
        where: { taxId: dto.ein },
      });
      if (existing) {
        throw new ConflictException(`Organization with EIN ${dto.ein} already exists`);
      }
    }

    const organization = await this.prisma.organization.create({
      data: {
        id: uuidv4(),
        name: dto.name,
        legalName: dto.legalName,
        taxId: dto.ein,
        entityType: dto.entityType,
        accountingMethod: dto.accountingMethod,
        fiscalYearEnd: dto.fiscalYearEnd || 12,
        stateOfIncorporation: dto.stateOfIncorporation,
        industry: dto.industry,
        naicsCode: dto.naicsCode,
        defaultCurrency: dto.defaultCurrency || 'USD',
        settings: (dto.settings || {}) as Prisma.InputJsonObject,
        isActive: true,
      },
    });

    // Create default chart of accounts for the organization
    await this.createDefaultChartOfAccounts(organization.id, dto.entityType);

    return organization;
  }

  async findAll(options: {
    ids?: string[];
    skip?: number;
    take?: number;
    isActive?: boolean;
  } = {}) {
    const { skip = 0, take = 50, isActive } = options;

    const where = {
      ...(isActive !== undefined && { isActive }),
      ...(options.ids && { id: { in: options.ids } }),
    };

    const [items, total] = await Promise.all([
      this.prisma.organization.findMany({
        where,
        skip,
        take,
        orderBy: { name: 'asc' },
      }),
      this.prisma.organization.count({ where }),
    ]);

    return {
      items,
      total,
      page: Math.floor(skip / take) + 1,
      pageSize: take,
      totalPages: Math.ceil(total / take),
    };
  }

  async findById(id: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            chartOfAccounts: true,
            journals: true,
            fiscalPeriods: true,
          },
        },
      },
    });

    if (!organization) {
      throw new NotFoundException(`Organization with ID ${id} not found`);
    }

    return organization;
  }

  async update(id: string, dto: UpdateOrganizationDto) {
    await this.findById(id);

    // Check for duplicate EIN if being updated
    if (dto.ein) {
      const existing = await this.prisma.organization.findFirst({
        where: { taxId: dto.ein, id: { not: id } },
      });
      if (existing) {
        throw new ConflictException(`Organization with EIN ${dto.ein} already exists`);
      }
    }

    return this.prisma.organization.update({
      where: { id },
      data: {
        name: dto.name,
        legalName: dto.legalName,
        taxId: dto.ein,
        entityType: dto.entityType,
        accountingMethod: dto.accountingMethod,
        fiscalYearEnd: dto.fiscalYearEnd,
        stateOfIncorporation: dto.stateOfIncorporation,
        industry: dto.industry,
        naicsCode: dto.naicsCode,
        defaultCurrency: dto.defaultCurrency,
        settings: dto.settings as Prisma.InputJsonObject | undefined,
        isActive: dto.isActive,
      },
    });
  }

  async delete(id: string) {
    await this.findById(id);

    // Soft delete by setting isActive to false
    return this.prisma.organization.update({
      where: { id },
      data: { isActive: false },
    });
  }

  private async createDefaultChartOfAccounts(organizationId: string, entityType: string) {
    const defaultAccounts = this.getDefaultAccounts(entityType);

    // Parents are listed before their children, so each parent's id is known when a child is created.
    const idByCode = new Map<string, string>();
    for (const account of defaultAccounts) {
      const created = await this.prisma.account.create({
        data: {
          id: uuidv4(),
          organizationId,
          accountNumber: account.code,
          name: account.name,
          accountType: account.type,
          accountSubtype: account.subType,
          normalBalance: account.normalBalance,
          parentId: account.parentCode ? idByCode.get(account.parentCode) ?? null : null,
          isActive: true,
          isSystemAccount: true,
        },
      });
      idByCode.set(account.code, created.id);
    }
  }

  private getDefaultAccounts(entityType: string): DefaultAccount[] {
    // Standard chart of accounts - subset for initial setup
    const accounts: DefaultAccount[] = [
      // Assets (1000-1999)
      { code: '1000', name: 'Cash and Cash Equivalents', type: 'ASSET', subType: 'CURRENT_ASSET', normalBalance: 'DEBIT' },
      { code: '1010', name: 'Checking Account', type: 'ASSET', subType: 'CURRENT_ASSET', normalBalance: 'DEBIT', parentCode: '1000' },
      { code: '1020', name: 'Savings Account', type: 'ASSET', subType: 'CURRENT_ASSET', normalBalance: 'DEBIT', parentCode: '1000' },
      { code: '1100', name: 'Accounts Receivable', type: 'ASSET', subType: 'CURRENT_ASSET', normalBalance: 'DEBIT' },
      { code: '1200', name: 'Inventory', type: 'ASSET', subType: 'CURRENT_ASSET', normalBalance: 'DEBIT' },
      { code: '1300', name: 'Prepaid Expenses', type: 'ASSET', subType: 'CURRENT_ASSET', normalBalance: 'DEBIT' },
      { code: '1500', name: 'Fixed Assets', type: 'ASSET', subType: 'FIXED_ASSET', normalBalance: 'DEBIT' },
      { code: '1510', name: 'Equipment', type: 'ASSET', subType: 'FIXED_ASSET', normalBalance: 'DEBIT', parentCode: '1500' },
      { code: '1520', name: 'Furniture and Fixtures', type: 'ASSET', subType: 'FIXED_ASSET', normalBalance: 'DEBIT', parentCode: '1500' },
      { code: '1530', name: 'Vehicles', type: 'ASSET', subType: 'FIXED_ASSET', normalBalance: 'DEBIT', parentCode: '1500' },
      { code: '1590', name: 'Accumulated Depreciation', type: 'ASSET', subType: 'FIXED_ASSET', normalBalance: 'CREDIT', parentCode: '1500' },

      // Liabilities (2000-2999)
      { code: '2000', name: 'Accounts Payable', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', normalBalance: 'CREDIT' },
      { code: '2100', name: 'Accrued Liabilities', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', normalBalance: 'CREDIT' },
      { code: '2200', name: 'Payroll Liabilities', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', normalBalance: 'CREDIT' },
      { code: '2210', name: 'Wages Payable', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', normalBalance: 'CREDIT', parentCode: '2200' },
      { code: '2220', name: 'Payroll Taxes Payable', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', normalBalance: 'CREDIT', parentCode: '2200' },
      { code: '2300', name: 'Sales Tax Payable', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', normalBalance: 'CREDIT' },
      { code: '2400', name: 'Short-term Loans Payable', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', normalBalance: 'CREDIT' },
      { code: '2500', name: 'Long-term Debt', type: 'LIABILITY', subType: 'LONG_TERM_LIABILITY', normalBalance: 'CREDIT' },

      // Equity (3000-3999)
      { code: '3000', name: 'Owner\'s Equity', type: 'EQUITY', subType: 'EQUITY', normalBalance: 'CREDIT' },
      { code: '3100', name: 'Retained Earnings', type: 'EQUITY', subType: 'RETAINED_EARNINGS', normalBalance: 'CREDIT' },
      { code: '3200', name: 'Owner\'s Draws', type: 'EQUITY', subType: 'EQUITY', normalBalance: 'DEBIT' },

      // Revenue (4000-4999)
      { code: '4000', name: 'Revenue', type: 'REVENUE', subType: 'OPERATING_REVENUE', normalBalance: 'CREDIT' },
      { code: '4010', name: 'Product Sales', type: 'REVENUE', subType: 'OPERATING_REVENUE', normalBalance: 'CREDIT', parentCode: '4000' },
      { code: '4020', name: 'Service Revenue', type: 'REVENUE', subType: 'OPERATING_REVENUE', normalBalance: 'CREDIT', parentCode: '4000' },
      { code: '4100', name: 'Discounts Given', type: 'REVENUE', subType: 'OPERATING_REVENUE', normalBalance: 'DEBIT', parentCode: '4000' },
      { code: '4200', name: 'Returns and Allowances', type: 'REVENUE', subType: 'OPERATING_REVENUE', normalBalance: 'DEBIT', parentCode: '4000' },
      { code: '4500', name: 'Other Income', type: 'REVENUE', subType: 'OTHER_INCOME', normalBalance: 'CREDIT' },
      { code: '4510', name: 'Interest Income', type: 'REVENUE', subType: 'OTHER_INCOME', normalBalance: 'CREDIT', parentCode: '4500' },

      // Cost of Goods Sold (5000-5999)
      { code: '5000', name: 'Cost of Goods Sold', type: 'EXPENSE', subType: 'COST_OF_GOODS_SOLD', normalBalance: 'DEBIT' },
      { code: '5010', name: 'Purchases', type: 'EXPENSE', subType: 'COST_OF_GOODS_SOLD', normalBalance: 'DEBIT', parentCode: '5000' },
      { code: '5020', name: 'Freight In', type: 'EXPENSE', subType: 'COST_OF_GOODS_SOLD', normalBalance: 'DEBIT', parentCode: '5000' },
      { code: '5030', name: 'Direct Labor', type: 'EXPENSE', subType: 'COST_OF_GOODS_SOLD', normalBalance: 'DEBIT', parentCode: '5000' },

      // Operating Expenses (6000-6999)
      { code: '6000', name: 'Operating Expenses', type: 'EXPENSE', subType: 'OPERATING_EXPENSE', normalBalance: 'DEBIT' },
      { code: '6100', name: 'Salaries and Wages', type: 'EXPENSE', subType: 'OPERATING_EXPENSE', normalBalance: 'DEBIT', parentCode: '6000' },
      { code: '6110', name: 'Payroll Taxes Expense', type: 'EXPENSE', subType: 'OPERATING_EXPENSE', normalBalance: 'DEBIT', parentCode: '6000' },
      { code: '6120', name: 'Employee Benefits', type: 'EXPENSE', subType: 'OPERATING_EXPENSE', normalBalance: 'DEBIT', parentCode: '6000' },
      { code: '6200', name: 'Rent Expense', type: 'EXPENSE', subType: 'OPERATING_EXPENSE', normalBalance: 'DEBIT', parentCode: '6000' },
      { code: '6300', name: 'Utilities', type: 'EXPENSE', subType: 'OPERATING_EXPENSE', normalBalance: 'DEBIT', parentCode: '6000' },
      { code: '6400', name: 'Office Supplies', type: 'EXPENSE', subType: 'OPERATING_EXPENSE', normalBalance: 'DEBIT', parentCode: '6000' },
      { code: '6500', name: 'Insurance', type: 'EXPENSE', subType: 'OPERATING_EXPENSE', normalBalance: 'DEBIT', parentCode: '6000' },
      { code: '6600', name: 'Professional Fees', type: 'EXPENSE', subType: 'OPERATING_EXPENSE', normalBalance: 'DEBIT', parentCode: '6000' },
      { code: '6700', name: 'Advertising and Marketing', type: 'EXPENSE', subType: 'OPERATING_EXPENSE', normalBalance: 'DEBIT', parentCode: '6000' },
      { code: '6800', name: 'Travel and Entertainment', type: 'EXPENSE', subType: 'OPERATING_EXPENSE', normalBalance: 'DEBIT', parentCode: '6000' },
      { code: '6900', name: 'Depreciation Expense', type: 'EXPENSE', subType: 'OPERATING_EXPENSE', normalBalance: 'DEBIT', parentCode: '6000' },

      // Other Expenses (7000-7999)
      { code: '7000', name: 'Other Expenses', type: 'EXPENSE', subType: 'OTHER_EXPENSE', normalBalance: 'DEBIT' },
      { code: '7100', name: 'Interest Expense', type: 'EXPENSE', subType: 'OTHER_EXPENSE', normalBalance: 'DEBIT', parentCode: '7000' },
      { code: '7200', name: 'Bank Fees', type: 'EXPENSE', subType: 'OTHER_EXPENSE', normalBalance: 'DEBIT', parentCode: '7000' },
    ];

    // Add entity-specific accounts
    if (entityType === 'C_CORP' || entityType === 'S_CORP') {
      accounts.push(
        { code: '3010', name: 'Common Stock', type: 'EQUITY', subType: 'EQUITY', normalBalance: 'CREDIT', parentCode: '3000' },
        { code: '3020', name: 'Additional Paid-in Capital', type: 'EQUITY', subType: 'EQUITY', normalBalance: 'CREDIT', parentCode: '3000' },
        { code: '3030', name: 'Treasury Stock', type: 'EQUITY', subType: 'EQUITY', normalBalance: 'DEBIT', parentCode: '3000' },
      );
    }

    return accounts;
  }
}
