# Sales Tax Module

Comprehensive sales tax management system for Synergy Books.

## Features

### 1. Tax Rate Management
- Create and manage tax rates by jurisdiction (federal, state, county, city, district, special)
- Support for compound tax rates
- ZIP code-based tax rate application
- Effective date and expiration date tracking
- FIPS code support for geographic accuracy

### 2. Tax Agency Management
- Register tax agencies and collection authorities
- Configure filing frequencies (monthly, quarterly, annually, semi-annually)
- Set due dates and grace periods
- Link to liability and expense accounts
- Track agency contact information

### 3. Automatic Tax Calculation
- Real-time tax calculation for invoices and sales
- Location-based tax rate application
- Customer tax exemption support
- Product-specific taxability rules
- Compound tax calculation support

### 4. Tax Liability Tracking
- Automatic accrual of tax liabilities by period
- Period-based tax collection tracking
- Multiple tax agency support
- Due date calculation based on filing frequency

### 5. Tax Filing & Payments
- Record tax return filings
- Track confirmation numbers
- Link payments to filings
- Support multiple filing methods (online, mail, fax)
- Payment method tracking

### 6. Reporting
- Tax summary reports by period
- Tax liability reports by agency
- Taxable vs exempt sales tracking
- Tax collected vs paid analysis

## API Endpoints

### Tax Rates

#### Create Tax Rate
```http
POST /organizations/:organizationId/sales-tax/rates
```

```json
{
  "name": "California State Tax",
  "jurisdiction": "CA",
  "jurisdictionType": "STATE",
  "rate": 0.0725,
  "effectiveDate": "2024-01-01",
  "zipCodes": ["90210", "90211"]
}
```

#### Get Tax Rates
```http
GET /organizations/:organizationId/sales-tax/rates?jurisdiction=CA&isActive=true
```

#### Update Tax Rate
```http
PUT /organizations/:organizationId/sales-tax/rates/:taxRateId
```

#### Deactivate Tax Rate
```http
DELETE /organizations/:organizationId/sales-tax/rates/:taxRateId
```

### Tax Agencies

#### Create Tax Agency
```http
POST /organizations/:organizationId/sales-tax/agencies
```

```json
{
  "name": "California Department of Tax and Fee Administration",
  "jurisdiction": "CA",
  "jurisdictionType": "STATE",
  "filingFrequency": "QUARTERLY",
  "accountNumber": "123-456-789",
  "dueDayOfMonth": 30,
  "gracePeriodDays": 10,
  "liabilityAccountId": "acc-123",
  "website": "https://www.cdtfa.ca.gov",
  "phone": "1-800-400-7115"
}
```

#### Get Tax Agencies
```http
GET /organizations/:organizationId/sales-tax/agencies
```

### Tax Calculation

#### Calculate Tax
```http
POST /organizations/:organizationId/sales-tax/calculate
```

```json
{
  "lineItems": [
    {
      "amount": 100.00,
      "isTaxable": true,
      "productCategory": "general"
    }
  ],
  "shipToAddress": {
    "state": "CA",
    "city": "Beverly Hills",
    "zipCode": "90210"
  },
  "customerId": "cust-123",
  "transactionDate": "2024-01-15"
}
```

Response:
```json
{
  "subtotal": 100.00,
  "taxableAmount": 100.00,
  "exemptAmount": 0.00,
  "taxes": [
    {
      "taxRateId": "rate-1",
      "name": "California State Tax",
      "jurisdiction": "CA",
      "rate": 0.0725,
      "taxableAmount": 100.00,
      "taxAmount": 7.25
    },
    {
      "taxRateId": "rate-2",
      "name": "Los Angeles County Tax",
      "jurisdiction": "Los Angeles County",
      "rate": 0.0100,
      "taxableAmount": 100.00,
      "taxAmount": 1.00
    }
  ],
  "totalTax": 8.25,
  "total": 108.25
}
```

### Tax Liabilities

#### Get Tax Liabilities
```http
GET /organizations/:organizationId/sales-tax/liabilities?agencyId=agency-123&status=ACCRUING&year=2024
```

#### File Tax Return
```http
POST /organizations/:organizationId/sales-tax/liabilities/:liabilityId/file
```

```json
{
  "filedBy": "John Doe",
  "filingMethod": "online",
  "confirmationNumber": "CONF-2024-Q1-123456",
  "paymentAmount": 850.50,
  "paymentMethod": "ACH",
  "paymentReference": "ACH-20240115-001"
}
```

### Reports

#### Tax Summary Report
```http
GET /organizations/:organizationId/sales-tax/summary?startDate=2024-01-01&endDate=2024-03-31
```

Response:
```json
{
  "period": {
    "startDate": "2024-01-01",
    "endDate": "2024-03-31"
  },
  "totalTaxableSales": 50000.00,
  "totalExemptSales": 5000.00,
  "totalTaxCollected": 3625.00,
  "totalTaxPaid": 3000.00,
  "totalTaxDue": 625.00,
  "byAgency": [
    {
      "agencyName": "California CDTFA",
      "jurisdiction": "CA",
      "taxableSales": 50000.00,
      "exemptSales": 5000.00,
      "taxCollected": 3625.00,
      "taxPaid": 3000.00,
      "taxDue": 625.00,
      "status": "ACCRUING"
    }
  ]
}
```

## Integration with Invoices

The Sales Tax module integrates with the invoicing system through the `SalesTaxIntegrationService`:

```typescript
// Calculate tax when creating an invoice
const taxResult = await salesTaxIntegrationService.calculateInvoiceTax(organizationId, {
  invoiceId: 'inv-123',
  customerId: 'cust-456',
  lines: [
    { amount: 100, inventoryItemId: 'item-789' }
  ],
  transactionDate: new Date()
});

// Record tax liability when invoice is finalized
await salesTaxIntegrationService.recordInvoiceTaxLiability(
  organizationId,
  invoiceId,
  taxAmount,
  taxableAmount,
  invoiceDate
);

// Get effective tax rate for a location
const rate = await salesTaxIntegrationService.getEffectiveTaxRate(organizationId, {
  state: 'CA',
  zipCode: '90210'
});
```

## Tax Exemptions

### Customer-Level Exemptions
Customers can be marked as tax-exempt:
```typescript
await customerService.update(customerId, { taxExempt: true });
```

### Product-Level Exemptions
Products can be marked as non-taxable:
```typescript
await prisma.productTaxability.create({
  data: {
    organizationId,
    inventoryItemId: 'item-123',
    isExempt: true,
    exemptionReason: 'Food - exempt under state law'
  }
});
```

## Compound Tax Rates

Some jurisdictions require compound taxes (tax on tax). The system supports this:

```json
{
  "name": "Quebec GST",
  "rate": 0.05,
  "isCompound": false
},
{
  "name": "Quebec QST",
  "rate": 0.09975,
  "isCompound": true
}
```

With a $100 purchase:
- GST: $100 × 5% = $5.00
- QST: ($100 + $5) × 9.975% = $10.47
- Total tax: $15.47

## Best Practices

1. **Keep Rates Updated**: Regularly update tax rates as jurisdictions change them
2. **Set Effective Dates**: Always use effective dates when creating new rates
3. **Archive Old Rates**: Don't delete rates; use endDate to expire them
4. **Regular Filing**: File returns on time to avoid penalties
5. **Reconcile Monthly**: Compare tax collected vs liabilities recorded
6. **Document Exemptions**: Keep certificates for tax-exempt customers
7. **Test Calculations**: Verify tax calculations match jurisdiction requirements

## Database Schema

The module uses the following Prisma models:

- `SalesTaxRate` - Tax rate definitions
- `TaxAgency` - Tax collection agencies
- `SalesTaxLiability` - Tax liabilities by period
- `SalesTaxFiling` - Tax return filings
- `ProductTaxability` - Product-specific tax rules

## Error Handling

The service includes proper error handling:
- `NotFoundException` - When rate, agency, or liability not found
- `BadRequestException` - For invalid input data
- Logging for tax calculation issues
- Graceful handling of missing addresses

## Testing

Run tests:
```bash
npm test -- sales-tax.service.spec
```

The test suite covers:
- Tax rate creation and management
- Tax calculation scenarios
- Customer exemptions
- Compound tax rates
- Liability recording
- Tax return filing

## Future Enhancements

- Avalara/TaxJar API integration for automatic rate updates
- Nexus tracking for multi-state compliance
- E-filing integration
- Advanced exemption certificate management
- Tax forecasting and planning tools
- Audit trail for all tax-related transactions
