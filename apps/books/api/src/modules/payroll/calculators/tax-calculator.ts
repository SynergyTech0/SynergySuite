import { Injectable } from '@nestjs/common';

// 2024 Federal Tax Brackets (Single)
const FEDERAL_TAX_BRACKETS_SINGLE_2024 = [
  { min: 0, max: 11600, rate: 0.10 },
  { min: 11600, max: 47150, rate: 0.12 },
  { min: 47150, max: 100525, rate: 0.22 },
  { min: 100525, max: 191950, rate: 0.24 },
  { min: 191950, max: 243725, rate: 0.32 },
  { min: 243725, max: 609350, rate: 0.35 },
  { min: 609350, max: Infinity, rate: 0.37 },
];

// 2024 Federal Tax Brackets (Married Filing Jointly)
const FEDERAL_TAX_BRACKETS_MARRIED_2024 = [
  { min: 0, max: 23200, rate: 0.10 },
  { min: 23200, max: 94300, rate: 0.12 },
  { min: 94300, max: 201050, rate: 0.22 },
  { min: 201050, max: 383900, rate: 0.24 },
  { min: 383900, max: 487450, rate: 0.32 },
  { min: 487450, max: 731200, rate: 0.35 },
  { min: 731200, max: Infinity, rate: 0.37 },
];

// FICA 2024
const SOCIAL_SECURITY_RATE = 0.062;
const SOCIAL_SECURITY_WAGE_BASE_2024 = 168600;
const MEDICARE_RATE = 0.0145;
const ADDITIONAL_MEDICARE_RATE = 0.009;
const ADDITIONAL_MEDICARE_THRESHOLD = 200000;

// State tax rates (simplified - real implementation would have more detail)
const STATE_TAX_RATES: Record<string, { rate: number; standardDeduction: number }> = {
  CA: { rate: 0.0725, standardDeduction: 5202 },
  NY: { rate: 0.0685, standardDeduction: 8000 },
  TX: { rate: 0, standardDeduction: 0 }, // No state income tax
  FL: { rate: 0, standardDeduction: 0 }, // No state income tax
  WA: { rate: 0, standardDeduction: 0 }, // No state income tax
  IL: { rate: 0.0495, standardDeduction: 0 }, // Flat rate
  PA: { rate: 0.0307, standardDeduction: 0 }, // Flat rate
  NJ: { rate: 0.0637, standardDeduction: 1000 },
  GA: { rate: 0.055, standardDeduction: 5400 },
  NC: { rate: 0.0525, standardDeduction: 12750 },
  // Add more states as needed
};

export interface TaxCalculationInput {
  grossPay: number;
  ytdGrossPay: number;
  filingStatus: 'SINGLE' | 'MARRIED';
  federalAllowances: number;
  stateCode: string;
  stateAllowances: number;
  preTaxDeductions: number;
  ytdSocialSecurityWages: number;
  ytdMedicareWages: number;
  additionalFederalWithholding: number;
  additionalStateWithholding: number;
}

export interface TaxCalculationResult {
  federalTax: number;
  socialSecurityTax: number;
  medicareTax: number;
  stateTax: number;
  localTax: number;
  totalTax: number;
  taxableWages: {
    federal: number;
    socialSecurity: number;
    medicare: number;
    state: number;
  };
  employerTaxes: {
    socialSecurity: number;
    medicare: number;
    futa: number;
    suta: number;
  };
}

@Injectable()
export class TaxCalculator {
  calculatePayrollTaxes(input: TaxCalculationInput): TaxCalculationResult {
    const taxableWagesFederal = Math.max(0, input.grossPay - input.preTaxDeductions);

    // Federal Income Tax
    const federalTax = this.calculateFederalTax(
      taxableWagesFederal,
      input.filingStatus,
      input.federalAllowances,
    ) + input.additionalFederalWithholding;

    // Social Security Tax
    const socialSecurityTax = this.calculateSocialSecurityTax(
      input.grossPay,
      input.ytdSocialSecurityWages,
    );

    // Medicare Tax
    const medicareTax = this.calculateMedicareTax(
      input.grossPay,
      input.ytdMedicareWages,
    );

    // State Tax
    const stateTax = this.calculateStateTax(
      taxableWagesFederal,
      input.stateCode,
      input.stateAllowances,
    ) + input.additionalStateWithholding;

    // Employer taxes
    const employerSocialSecurity = socialSecurityTax; // Employer matches
    const employerMedicare = input.grossPay * MEDICARE_RATE; // Employer matches base rate
    const futa = this.calculateFUTA(input.grossPay, input.ytdGrossPay);
    const suta = this.calculateSUTA(input.grossPay, input.ytdGrossPay, input.stateCode);

    return {
      federalTax: Math.round(federalTax * 100) / 100,
      socialSecurityTax: Math.round(socialSecurityTax * 100) / 100,
      medicareTax: Math.round(medicareTax * 100) / 100,
      stateTax: Math.round(stateTax * 100) / 100,
      localTax: 0, // Add local tax calculation if needed
      totalTax: Math.round((federalTax + socialSecurityTax + medicareTax + stateTax) * 100) / 100,
      taxableWages: {
        federal: taxableWagesFederal,
        socialSecurity: input.grossPay,
        medicare: input.grossPay,
        state: taxableWagesFederal,
      },
      employerTaxes: {
        socialSecurity: Math.round(employerSocialSecurity * 100) / 100,
        medicare: Math.round(employerMedicare * 100) / 100,
        futa: Math.round(futa * 100) / 100,
        suta: Math.round(suta * 100) / 100,
      },
    };
  }

  private calculateFederalTax(
    annualizedWages: number,
    filingStatus: 'SINGLE' | 'MARRIED',
    allowances: number,
  ): number {
    // Annualize for accurate bracket calculation
    const brackets = filingStatus === 'MARRIED'
      ? FEDERAL_TAX_BRACKETS_MARRIED_2024
      : FEDERAL_TAX_BRACKETS_SINGLE_2024;

    // Standard deduction equivalent per paycheck (simplified)
    const perPaycheckDeduction = filingStatus === 'MARRIED' ? 29200 / 26 : 14600 / 26;
    const allowanceDeduction = allowances * 4300 / 26; // $4,300 per allowance annually

    const taxableIncome = Math.max(0, annualizedWages - perPaycheckDeduction - allowanceDeduction);

    // Calculate using progressive brackets (annualized then de-annualized)
    const annualizedTaxable = taxableIncome * 26; // Assume bi-weekly
    let annualTax = 0;
    let remainingIncome = annualizedTaxable;

    for (const bracket of brackets) {
      if (remainingIncome <= 0) break;

      const taxableInBracket = Math.min(
        remainingIncome,
        bracket.max - bracket.min,
      );
      annualTax += taxableInBracket * bracket.rate;
      remainingIncome -= taxableInBracket;
    }

    return annualTax / 26; // Return per-paycheck amount
  }

  private calculateSocialSecurityTax(
    grossPay: number,
    ytdSocialSecurityWages: number,
  ): number {
    const remainingWageBase = Math.max(0, SOCIAL_SECURITY_WAGE_BASE_2024 - ytdSocialSecurityWages);
    const taxableWages = Math.min(grossPay, remainingWageBase);
    return taxableWages * SOCIAL_SECURITY_RATE;
  }

  private calculateMedicareTax(
    grossPay: number,
    ytdMedicareWages: number,
  ): number {
    let tax = grossPay * MEDICARE_RATE;

    // Additional Medicare Tax for high earners
    const newYtd = ytdMedicareWages + grossPay;
    if (newYtd > ADDITIONAL_MEDICARE_THRESHOLD) {
      const additionalTaxableWages = newYtd - Math.max(ytdMedicareWages, ADDITIONAL_MEDICARE_THRESHOLD);
      tax += Math.min(grossPay, additionalTaxableWages) * ADDITIONAL_MEDICARE_RATE;
    }

    return tax;
  }

  private calculateStateTax(
    taxableWages: number,
    stateCode: string,
    allowances: number,
  ): number {
    const stateConfig = STATE_TAX_RATES[stateCode.toUpperCase()];
    if (!stateConfig || stateConfig.rate === 0) {
      return 0;
    }

    const allowanceDeduction = allowances * 1000 / 26; // Simplified
    const adjustedWages = Math.max(0, taxableWages - stateConfig.standardDeduction / 26 - allowanceDeduction);

    return adjustedWages * stateConfig.rate;
  }

  private calculateFUTA(grossPay: number, ytdGrossPay: number): number {
    const FUTA_WAGE_BASE = 7000;
    const FUTA_RATE = 0.006; // After credit for state unemployment

    const remainingWageBase = Math.max(0, FUTA_WAGE_BASE - ytdGrossPay);
    const taxableWages = Math.min(grossPay, remainingWageBase);
    return taxableWages * FUTA_RATE;
  }

  private calculateSUTA(
    grossPay: number,
    ytdGrossPay: number,
    stateCode: string,
  ): number {
    // SUTA rates vary by state and employer experience rating
    // Using simplified default rates
    const SUTA_RATES: Record<string, { rate: number; wageBase: number }> = {
      CA: { rate: 0.034, wageBase: 7000 },
      NY: { rate: 0.039, wageBase: 12300 },
      TX: { rate: 0.027, wageBase: 9000 },
      FL: { rate: 0.027, wageBase: 7000 },
      // Add more states
    };

    const stateConfig = SUTA_RATES[stateCode.toUpperCase()] || { rate: 0.03, wageBase: 7000 };
    const remainingWageBase = Math.max(0, stateConfig.wageBase - ytdGrossPay);
    const taxableWages = Math.min(grossPay, remainingWageBase);
    return taxableWages * stateConfig.rate;
  }

  // Helper method to get annualized salary from pay frequency
  getAnnualizedAmount(amount: number, payFrequency: string): number {
    switch (payFrequency) {
      case 'WEEKLY': return amount * 52;
      case 'BIWEEKLY': return amount * 26;
      case 'SEMIMONTHLY': return amount * 24;
      case 'MONTHLY': return amount * 12;
      default: return amount * 26;
    }
  }

  // Calculate per-paycheck amount from annual
  getPerPaycheckAmount(annualAmount: number, payFrequency: string): number {
    switch (payFrequency) {
      case 'WEEKLY': return annualAmount / 52;
      case 'BIWEEKLY': return annualAmount / 26;
      case 'SEMIMONTHLY': return annualAmount / 24;
      case 'MONTHLY': return annualAmount / 12;
      default: return annualAmount / 26;
    }
  }
}
