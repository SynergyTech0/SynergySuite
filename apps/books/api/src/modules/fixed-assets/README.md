# Fixed Assets & Depreciation Module

Comprehensive fixed asset tracking and depreciation management system for Synergy Books.

## Features

### 1. Asset Lifecycle Management
- Asset acquisition and registration
- Detailed asset information tracking
- Asset updates and modifications
- Asset disposal with gain/loss calculation
- Complete audit trail

### 2. Multiple Depreciation Methods
- **Straight-Line** - Equal depreciation over useful life
- **Declining Balance** - Accelerated depreciation
- **Double-Declining Balance** - 200% declining balance
- **MACRS GDS** - Modified Accelerated Cost Recovery System (General Depreciation System)
- **MACRS ADS** - Alternative Depreciation System
- **Section 179** - Immediate expensing election
- **No Depreciation** - For land and non-depreciating assets

### 3. Automatic Depreciation Calculation
- Monthly depreciation calculation
- Batch processing for all assets
- Salvage value protection
- Fully automated workflows
- Historical tracking

### 4. Asset Types Supported
- Buildings
- Equipment
- Vehicles
- Computer Equipment
- Furniture & Fixtures
- Software
- Land (non-depreciating)
- Leasehold Improvements
- Other Custom Types

### 5. Comprehensive Reporting
- Asset summary reports
- Depreciation schedules
- Depreciation forecasts
- Asset valuations
- Gain/loss reports on disposals

## API Endpoints

### Asset Management

#### Create Asset
```http
POST /organizations/:orgId/fixed-assets
```

```json
{
  "assetNumber": "EQUIP-001",
  "name": "Delivery Truck",
  "description": "Ford F-150 Delivery Truck",
  "assetType": "VEHICLE",
  "acquisitionDate": "2024-01-01",
  "acquisitionCost": 50000,
  "salvageValue": 5000,
  "usefulLifeMonths": 60,
  "depreciationMethod": "STRAIGHT_LINE",
  "serialNumber": "1FTPW14V14FA12345",
  "location": "Warehouse A",
  "department": "Logistics",
  "assetAccountId": "acc-vehicles",
  "accumulatedDepAccountId": "acc-accum-dep",
  "depreciationExpenseAccountId": "acc-dep-expense"
}
```

#### List Assets
```http
GET /organizations/:orgId/fixed-assets?status=ACTIVE&assetType=VEHICLE
```

#### Get Asset Details
```http
GET /organizations/:orgId/fixed-assets/:assetId
```

#### Update Asset
```http
PUT /organizations/:orgId/fixed-assets/:assetId
```

```json
{
  "name": "Updated Asset Name",
  "location": "New Location",
  "department": "New Department"
}
```

### Depreciation

#### Calculate Depreciation for Period
```http
POST /organizations/:orgId/fixed-assets/:assetId/depreciate
```

```json
{
  "periodDate": "2024-02-01"
}
```

#### Run Monthly Depreciation (All Assets)
```http
POST /organizations/:orgId/fixed-assets/run-monthly
```

```json
{
  "periodDate": "2024-02-01"
}
```

Response:
```json
{
  "processed": 15,
  "results": [
    {
      "assetId": "asset-1",
      "success": true,
      "entry": {
        "id": "entry-123",
        "depreciationAmount": 833.33,
        "accumulatedTotal": 10000,
        "bookValue": 40000
      }
    }
  ]
}
```

#### Get Depreciation Schedule
```http
GET /organizations/:orgId/fixed-assets/:assetId/schedule
```

Response:
```json
{
  "asset": {
    "id": "asset-1",
    "name": "Delivery Truck",
    "acquisitionCost": 50000,
    "salvageValue": 5000,
    "usefulLifeMonths": 60,
    "method": "STRAIGHT_LINE"
  },
  "entries": [
    {
      "periodDate": "2024-01-31",
      "depreciationAmount": 750,
      "accumulatedTotal": 750,
      "bookValue": 49250
    },
    {
      "periodDate": "2024-02-29",
      "depreciationAmount": 750,
      "accumulatedTotal": 1500,
      "bookValue": 48500
    }
  ]
}
```

### Asset Disposal

#### Dispose Asset
```http
POST /organizations/:orgId/fixed-assets/:assetId/dispose
```

```json
{
  "disposalDate": "2024-12-01",
  "disposalMethod": "SALE",
  "salePrice": 25000,
  "saleExpenses": 500,
  "buyerName": "ABC Company",
  "notes": "Asset sold to upgrade fleet"
}
```

Response:
```json
{
  "assetId": "asset-1",
  "bookValue": 20000,
  "netProceeds": 24500,
  "gainLoss": 4500
}
```

### Reports

#### Asset Summary Report
```http
GET /organizations/:orgId/fixed-assets/reports/summary
```

Response:
```json
{
  "totalAssets": 50,
  "activeAssets": 42,
  "fullyDepreciated": 6,
  "disposed": 2,
  "totalAcquisitionCost": 5000000,
  "totalAccumulatedDepreciation": 1200000,
  "totalBookValue": 3800000,
  "byType": {
    "VEHICLE": {
      "count": 15,
      "acquisitionCost": 750000,
      "bookValue": 550000
    },
    "EQUIPMENT": {
      "count": 20,
      "acquisitionCost": 2000000,
      "bookValue": 1600000
    }
  },
  "byMethod": {
    "STRAIGHT_LINE": {
      "count": 35,
      "acquisitionCost": 3500000
    },
    "MACRS_GDS": {
      "count": 15,
      "acquisitionCost": 1500000
    }
  }
}
```

#### Depreciation Forecast
```http
GET /organizations/:orgId/fixed-assets/reports/depreciation-forecast?months=12
```

Response:
```json
{
  "forecastMonths": 12,
  "totalProjectedDepreciation": 600000,
  "forecast": [
    {
      "month": "2024-01",
      "totalDepreciation": 50000,
      "assetCount": 42,
      "byMethod": {
        "STRAIGHT_LINE": 30000,
        "MACRS_GDS": 20000
      }
    }
  ]
}
```

## Depreciation Methods Explained

### Straight-Line Depreciation
Depreciates evenly over the asset's useful life.

**Formula:** `(Cost - Salvage Value) / Useful Life`

**Example:**
- Cost: $60,000
- Salvage: $0
- Life: 60 months
- Monthly Depreciation: $1,000

### Double-Declining Balance
Accelerated depreciation method that applies a fixed rate to the declining book value.

**Formula:** `Book Value × (2 / Useful Life)`

**Example:**
- Cost: $100,000
- Life: 60 months
- Rate: 2/60 = 3.33%
- Year 1: $100,000 × 3.33% = $3,333/month
- Year 2: $80,000 × 3.33% = $2,667/month

### MACRS (Modified Accelerated Cost Recovery System)
IRS-approved depreciation method for tax purposes.

**MACRS Classes:**
- 3-year: Certain tools, horses
- 5-year: Cars, computers, office equipment
- 7-year: Office furniture, most equipment
- 10-year: Vessels, barges
- 15-year: Improvements, gas stations
- 20-year: Farm buildings
- 27.5-year: Residential rental property
- 39-year: Commercial property

**Example (5-year MACRS):**
- Year 1: 20.00%
- Year 2: 32.00%
- Year 3: 19.20%
- Year 4: 11.52%
- Year 5: 11.52%
- Year 6: 5.76%

### Section 179
Allows immediate expensing of qualifying assets up to $1,160,000 (2023 limit).

**Benefits:**
- Immediate tax deduction
- Reduces first-year tax liability
- Simplifies bookkeeping

## Asset Statuses

- **ACTIVE** - Currently in use and depreciating
- **FULLY_DEPRECIATED** - Reached salvage value
- **SOLD** - Asset was sold
- **DISPOSED** - Asset was disposed (scrapped, donated, etc.)
- **INACTIVE** - Temporarily not in use

## Disposal Methods

- **SALE** - Asset sold to third party
- **TRADE_IN** - Asset traded for another
- **SCRAP** - Asset scrapped/written off
- **DONATION** - Asset donated to charity
- **THEFT** - Asset stolen
- **CASUALTY** - Asset destroyed (fire, flood, etc.)
- **OTHER** - Other disposal method

## Integration with Accounting

### Journal Entries

#### Asset Acquisition
```
Debit:  Asset Account         $50,000
Credit: Cash/Accounts Payable  $50,000
```

#### Monthly Depreciation
```
Debit:  Depreciation Expense   $833
Credit: Accumulated Depreciation $833
```

#### Asset Disposal (Gain)
```
Debit:  Cash                   $25,000
Debit:  Accumulated Depreciation $30,000
Credit: Asset Account          $50,000
Credit: Gain on Disposal       $5,000
```

#### Asset Disposal (Loss)
```
Debit:  Cash                   $15,000
Debit:  Accumulated Depreciation $30,000
Debit:  Loss on Disposal       $5,000
Credit: Asset Account          $50,000
```

## Best Practices

1. **Choose Appropriate Depreciation Method**
   - Use MACRS for tax reporting
   - Use straight-line for financial reporting
   - Consider matching principle

2. **Regular Depreciation Runs**
   - Run monthly depreciation on schedule
   - Review and verify entries
   - Post to general ledger

3. **Physical Asset Verification**
   - Conduct annual physical counts
   - Update locations and conditions
   - Identify missing or damaged assets

4. **Salvage Value Estimates**
   - Be conservative with estimates
   - Review periodically
   - Adjust if market conditions change

5. **Documentation**
   - Keep purchase invoices
   - Maintain serial numbers
   - Document disposal details
   - Retain for tax audit periods (7+ years)

6. **Asset Tagging**
   - Use unique asset numbers
   - Apply physical tags/labels
   - Maintain tag inventory

7. **Impairment Testing**
   - Test for impairment annually
   - Write down if fair value < book value
   - Document impairment decisions

## Database Schema

The module uses the following Prisma models:

- `FixedAsset` - Asset master records
- `AssetAccounts` - GL account mappings
- `AssetDepreciation` - Depreciation schedules
- `DepreciationEntry` - Monthly depreciation records
- `AssetDisposal` - Disposal transactions

## Common Scenarios

### Scenario 1: Purchase New Equipment
```typescript
const asset = await fixedAssetsService.createAsset(organizationId, {
  assetNumber: 'EQUIP-2024-001',
  name: 'CNC Machine',
  assetType: 'EQUIPMENT',
  acquisitionDate: new Date('2024-01-15'),
  acquisitionCost: 120000,
  salvageValue: 10000,
  usefulLifeMonths: 84, // 7 years
  depreciationMethod: 'MACRS_GDS',
  macrsClass: '7',
  assetAccountId: 'acc-equipment',
  accumulatedDepAccountId: 'acc-accum-dep-equip',
  depreciationExpenseAccountId: 'acc-dep-exp-equip',
});
```

### Scenario 2: Monthly Depreciation Run
```typescript
// Run at month-end
const periodDate = new Date('2024-01-31');
const result = await fixedAssetsService.runMonthlyDepreciation(
  organizationId,
  periodDate
);

console.log(`Processed ${result.processed} assets`);
console.log(`Successful: ${result.results.filter(r => r.success).length}`);
```

### Scenario 3: Sell Asset
```typescript
const disposal = await fixedAssetsService.disposeAsset(
  organizationId,
  assetId,
  {
    disposalDate: new Date('2024-12-01'),
    disposalMethod: 'SALE',
    salePrice: 45000,
    saleExpenses: 1500,
    buyerName: 'XYZ Corporation',
    notes: 'Upgraded to newer model',
  }
);

console.log(`Gain/Loss: $${disposal.gainLoss}`);
```

## Testing

Run tests:
```bash
cd apps/books/api
npm test -- fixed-assets.service.spec
```

Test coverage includes:
- Asset creation with various depreciation methods
- Depreciation calculations (straight-line, double-declining, MACRS)
- Monthly batch depreciation
- Asset disposal with gain/loss
- Report generation
- Edge cases and error handling

## Future Enhancements

- Component depreciation for complex assets
- Impairment tracking and calculations
- Asset transfers between locations/departments
- Integration with maintenance tracking
- Asset photos and document attachments
- Barcode/QR code scanning
- Mobile asset management app
- Lease accounting (ASC 842/IFRS 16)
- International depreciation methods
- Tax form integration (Form 4562)

## Support

For issues or questions, contact the development team or refer to the main Synergy Books documentation.
