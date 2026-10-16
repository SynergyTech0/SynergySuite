// US state income tax WITHHOLDING formulas (employer percentage / annualized method).
// Compiled 2026-10-16. Amounts are annual US dollars; rates are decimals.
// Brackets are marginal: rate applies to annual taxable wages above `over`.
// Many 2026 figures were taken from USDA National Finance Center (NFC) payroll
// bulletins, which implement each state's published withholding formula for
// federal payroll; where so, `source` is the NFC bulletin and `notes` says so.

export type StateStatus = "single" | "married" | "head";
export interface StateBracket { over: number; rate: number }
export interface StateTable {
  year: number;
  source: string;
  method: "none" | "flat" | "brackets";
  flatRate?: number;
  brackets?: Partial<Record<StateStatus, StateBracket[]>>;
  standardDeduction?: Partial<Record<StateStatus, number>>;
  allowance?: number;
  allowanceCredit?: number;
  personalExemption?: Partial<Record<StateStatus, number>>;
  federalDeduction?: boolean;
  notes?: string;
}

const b = (...pairs: [number, number][]): StateBracket[] =>
  pairs.map(([over, rate]) => ({ over, rate }));

const NFC = "NFC payroll bulletin implementing the state formula";

export const STATE_TABLES: Record<string, StateTable> = {
  AK: { year: 2026, source: "https://tax.alaska.gov/", method: "none", notes: "No state income tax on wages." },

  AL: {
    year: 2025,
    source: "https://nationaltaxtools.com/payroll/alabama/paycheck-calculator/",
    method: "brackets",
    brackets: {
      single: b([0, 0.02], [500, 0.04], [3000, 0.05]),
      married: b([0, 0.02], [1000, 0.04], [6000, 0.05]),
      head: b([0, 0.02], [500, 0.04], [3000, 0.05]),
    },
    standardDeduction: { single: 2500, married: 5000, head: 2500 },
    personalExemption: { single: 1500, married: 3000, head: 3000 },
    allowance: 1000,
    federalDeduction: true,
    notes: "UNVERIFIED (confirmed only via secondary summary of the ADOR booklet). Standard deduction phases DOWN with gross wages: max S 3,000 / M 8,500 / H 5,200 / MS 4,250, reduced in steps to the floors shown (S 2,500, M 5,000, H 2,500, MS 2,500) by $35,500 gross (MS by $17,750); floors stored here. Status '0' (no A-4) gets no personal exemption; MS gets 1,500 and the single brackets. Per-dependent allowance is 1,000 for gross <= $50k, 500 for $50k-$100k, 300 above $100k (1,000 stored). Annual FEDERAL income tax withheld is subtracted before rates (no cap). Local occupational taxes (e.g. Birmingham) not included.",
  },

  AR: {
    year: 2026,
    source: "https://help.nfc.usda.gov/bulletins/2026/1781190112.htm",
    method: "brackets",
    brackets: { single: b([0, 0], [5599, 0.02], [11200, 0.03], [16000, 0.034], [26400, 0.037]) },
    standardDeduction: { single: 2470, married: 2470, head: 2470 },
    allowanceCredit: 29,
    notes: `${NFC} (effective PP15 2026; top rate cut 3.9%->3.7%). Official table is 'rate x net income minus adjustment'; converted to equivalent marginal brackets. For net income $94,701-$97,701 the subtracted adjustment shrinks in $100 steps (high-income phase-in) - not modeled (understates tax by up to ~$287 there). Low-income tax credit (sliding, S below $17,500, M below $29,000/$36,100, HOH below $25,300/$29,000) not modeled.`,
  },

  AZ: {
    year: 2026,
    source: "https://azdor.gov/",
    method: "flat",
    flatRate: 0.02,
    notes: "Arizona withholding is an employee-ELECTED percentage of gross taxable wages on Form A-4: 0.5%, 1.0%, 1.5%, 2.0%, 2.5%, 3.0% or 3.5% (or 0% if no liability expected). 2.0% is the default when no A-4 is filed. No deductions/allowances. Source is the AZDOR home page; 2026 rates unchanged from 2025 (Bloomberg Tax). Annual return rate is flat 2.5%.",
  },

  CA: {
    year: 2026,
    source: "https://edd.ca.gov/siteassets/files/pdf_pub_ctr/26methb.pdf",
    method: "brackets",
    brackets: {
      single: b([0, 0.011], [11079, 0.022], [26264, 0.044], [41452, 0.066], [57542, 0.088], [72724, 0.1023], [371479, 0.1133], [445771, 0.1243], [742953, 0.1353], [1000000, 0.1463]),
      married: b([0, 0.011], [22158, 0.022], [52528, 0.044], [82904, 0.066], [115084, 0.088], [145448, 0.1023], [742958, 0.1133], [891542, 0.1243], [1000000, 0.1353], [1485906, 0.1463]),
      head: b([0, 0.011], [22173, 0.022], [52530, 0.044], [67716, 0.066], [83805, 0.088], [98990, 0.1023], [505208, 0.1133], [606251, 0.1243], [1000000, 0.1353], [1010417, 0.1463]),
    },
    standardDeduction: { single: 5706, married: 11412, head: 11412 },
    allowanceCredit: 168.3,
    notes: "EDD DE 44 Method B (exact calculation), 2026. Low-income exemption: no withholding if annual wages <= 18,896 (S, dual-income M, or M with 0-1 allowances) or <= 37,791 (M with 2+ allowances, HOH). Married standard deduction is 5,706 (not 11,412) when married claims 0 or 1 allowance; married with 0-1 allowances also uses the 18,896 low-income threshold. 'Estimated deduction' allowances (DE 4 line 1b / W-4 additional) subtract 1,000 each from wages - separate from regular allowances, which are the 168.30 tax CREDIT each. Brackets include the 1% Mental Health Services tax above $1M. Supplemental rate 6.6% (10.23% bonuses/stock options). SDI (1.3% 2026, no wage cap) not included.",
  },

  CO: {
    year: 2026,
    source: "https://help.nfc.usda.gov/bulletins/2026/1772551649.htm",
    method: "flat",
    flatRate: 0.044,
    standardDeduction: { single: 5500, married: 11000, head: 5500 },
    notes: `${NFC} (effective PP02 2026; Colorado DR 0004). 'Annual withholding allowance' depends on federal W-4 filing status: MFJ/qualifying surviving spouse 11,000; all others 5,500. Employees may file DR 0004 to claim a different allowance. Denver/Aurora/Glendale/Greenwood Village/Sheridan occupational privilege taxes not included.`,
  },

  CT: {
    year: 2026,
    source: "https://www.halfpricesoft.com/2026/taxrate-connecticut-2026/",
    method: "brackets",
    brackets: {
      single: b([0, 0.02], [10000, 0.045], [50000, 0.055], [100000, 0.06], [200000, 0.065], [250000, 0.069], [500000, 0.0699]),
      married: b([0, 0.02], [20000, 0.045], [100000, 0.055], [200000, 0.06], [400000, 0.065], [500000, 0.069], [1000000, 0.0699]),
      head: b([0, 0.02], [16000, 0.045], [80000, 0.055], [160000, 0.06], [320000, 0.065], [400000, 0.069], [800000, 0.0699]),
    },
    personalExemption: { single: 15000, married: 24000, head: 19000 },
    notes: "UNVERIFIED (source is a third-party 2026 summary of DRS Circular CT; not confirmed against the official PDF). Status mapping: single=CT-W4 code F, married=code C (MFJ, spouse not working), head=code B. Code A (MFS/MFJ both working) uses single brackets with a 12,000 exemption; code D uses single brackets with NO exemption; no CT-W4 => code D. Personal exemption phases out $1,000 per $1,000 of wages: F over 30,000 (0 above 44,000), C over 48,000 (0 above 71,000), B over 38,000 (0 above 56,000), A over 24,000 (0 above 35,000). Not modeled: 2% rate phase-out add-back (F from ~56,500, max 250; C from ~100,500, max 500; B from ~78,500, max 400), benefit recapture (F/A/D from 105,000, max 3,400; C from 210,000, max 6,800; B from 168,000, max 5,320), and the personal tax credit (1%-75% of tax, decreasing with income).",
  },

  DC: {
    year: 2026,
    source: "https://www.halfpricesoft.com/2026/taxrate-districtofcolumbia-2026/",
    method: "brackets",
    brackets: { single: b([0, 0.04], [10000, 0.06], [40000, 0.065], [60000, 0.085], [250000, 0.0925], [500000, 0.0975], [1000000, 0.1075]) },
    allowance: 4150,
    notes: "UNVERIFIED (brackets and per-allowance amount from a third-party 2026 summary; official OTR tables not fetched). Same rate table for all statuses. Withholding allowance (D-4) 4,150 each; whether a separate standard deduction is subtracted in the OTR formula was not confirmed (annual return uses the federal standard deduction). DC PFL is employer-paid and out of scope.",
  },

  DE: {
    year: 2026,
    source: "https://revenue.delaware.gov/",
    method: "brackets",
    brackets: { single: b([0, 0], [2000, 0.022], [5000, 0.039], [10000, 0.048], [20000, 0.052], [25000, 0.0555], [60000, 0.066]) },
    standardDeduction: { single: 3250, married: 6500, head: 3250 },
    allowanceCredit: 110,
    notes: "UNVERIFIED (source is the DE Division of Revenue home page; figures confirmed only via secondary 2026 calculators; rates/deductions unchanged for many years). Personal credit 110 per allowance subtracted from tax. Married filing separately uses 3,250. Wilmington city wage tax (1.25%) not included.",
  },

  FL: { year: 2026, source: "https://floridarevenue.com/", method: "none", notes: "No state income tax." },

  GA: {
    year: 2026,
    source: "https://dor.georgia.gov/document/document/2026-employers-tax-guide-updated-june-2026/download",
    method: "flat",
    flatRate: 0.0499,
    standardDeduction: { single: 15000, married: 15000, head: 15000 },
    allowance: 5000,
    notes: "2026 Employer's Tax Guide (revised June 2026, HB 463). Rate 4.99% may be used starting May 11, 2026 (5.19% before that; tax year 2026 statutory rate is 4.99% retroactive to Jan 1). Standard deduction: Single/HOH 15,000; MFS or MFJ both spouses working (G-4 'N') 15,000; MFJ one spouse working (G-4 'M') 30,000 - married stored as 15,000. No personal exemption in the withholding formula; each dependent/additional allowance on G-4 = 5,000 (up from 4,000).",
  },

  HI: {
    year: 2026,
    source: "https://help.nfc.usda.gov/bulletins/2026/1768321238.htm",
    method: "brackets",
    brackets: {
      single: b([0, 0.014], [9600, 0.032], [14400, 0.055], [19200, 0.064], [24000, 0.068], [36000, 0.072], [48000, 0.076], [125000, 0.079]),
      married: b([0, 0.014], [19200, 0.032], [28800, 0.055], [38400, 0.064], [48000, 0.068], [72000, 0.072], [96000, 0.076], [250000, 0.079]),
    },
    allowance: 1144,
    notes: `${NFC} (effective PP15 2026; HI Booklet A). Head of household uses single table. Bulletin also lists a $4,350 'extra lump-sum withholding allowance amount' (standard-deduction-like); how it is applied was not confirmed, so it is not stored. HI TDI is out of scope.`,
  },

  IA: {
    year: 2026,
    source: "https://revenue.iowa.gov/media/53/download?inline",
    method: "flat",
    flatRate: 0.038,
    standardDeduction: { single: 13000, married: 26000, head: 19500 },
    allowanceCredit: 40,
    notes: "2026 IDR formula: T1 = wages - D; tax = T1 x 3.8% - W. D (annual): 'Other' or MFJ with working spouse 13,000; HOH 19,500; MFJ spouse with no earned income 26,000 (married stored as 26,000). On the 2024+ IA W-4 the employee enters a DOLLAR allowance amount W (credit) directly; on 2023-or-earlier IA W-4, W = allowances x 40 (stored as allowanceCredit).",
  },

  ID: {
    year: 2026,
    source: "https://help.nfc.usda.gov/bulletins/2026/1786997961.htm",
    method: "brackets",
    brackets: {
      single: b([0, 0], [16100, 0.053]),
      married: b([0, 0], [32200, 0.053]),
    },
    notes: `${NFC} (effective PP17 2026). 5.3% flat above a zero bracket equal to the 2026 federal standard deduction; per-allowance deduction reduced to $0 for 2026. HOH not given; single used (federal HOH deduction would be 24,150).`,
  },

  IL: {
    year: 2026,
    source: "https://help.nfc.usda.gov/bulletins/2026/1784121339.htm",
    method: "flat",
    flatRate: 0.0495,
    allowance: 2925,
    notes: `${NFC} (IL-700-T). Basic allowances (IL-W-4 line 1) 2,925 each; additional allowances (line 2: age 65+/blind) 1,000 each. Basic allowance amount phases to 0 for very high incomes on the return (not in withholding formula).`,
  },

  IN: {
    year: 2026,
    source: "https://help.nfc.usda.gov/bulletins/2026/1774379018.htm",
    method: "flat",
    flatRate: 0.0295,
    allowance: 1000,
    notes: `${NFC} (effective PP05 2026; rate 3.00%->2.95%). Personal exemptions 1,000 each; dependent exemptions 1,500 each (additional). County income taxes (roughly 0.5%-3.4%) not included.`,
  },

  KS: {
    year: 2025,
    source: "https://admin.ks.gov/offices/accounts-reports/informational-messages-and-circulars/payroll-circulars/25-p-004-new-kansas-state-withholding-tables",
    method: "brackets",
    brackets: {
      single: b([0, 0], [3605, 0.052], [26605, 0.0558]),
      married: b([0, 0], [8240, 0.052], [54240, 0.0558]),
    },
    allowance: 2320,
    notes: "Tables effective Oct 11, 2024 (KW-100 Rev. 10-24), still in use for 2025-2026. Zero bracket = built-in standard deduction (S 3,605 / joint 8,240) from a secondary summary of 'whrates.pdf' - not checked against KDOR PDF. Per Kansas DOA circular: the FIRST allowance (single) or first TWO allowances (married joint) are worth 9,160 each (personal exemption); each additional allowance is 2,320 (stored). Joint rate only when spouse has no income.",
  },

  KY: {
    year: 2026,
    source: "https://help.nfc.usda.gov/bulletins/2026/1770145550.htm",
    method: "flat",
    flatRate: 0.035,
    standardDeduction: { single: 3360, married: 3360, head: 3360 },
    notes: `${NFC} (effective PP02 2026; rate 4.0%->3.5%). No allowances. City/county occupational license taxes not included.`,
  },

  LA: {
    year: 2026,
    source: "https://help.nfc.usda.gov/bulletins/2026/1767639939.htm",
    method: "flat",
    flatRate: 0.0309,
    standardDeduction: { single: 12875, married: 25750, head: 12875 },
    notes: `${NFC} (effective PP15 2026). Withholding formula rate stated as 3.09% (return rate is flat 3.0% from 2025). Married claiming 1 standard deduction on L-4 gets 12,875; 2+ gets 25,750; 0 claimed gets 0.`,
  },

  MA: {
    year: 2026,
    source: "https://help.nfc.usda.gov/bulletins/2026/1769797447.htm",
    method: "brackets",
    brackets: { single: b([0, 0.05], [1107750, 0.09]) },
    personalExemption: { single: 3400, married: 3400, head: 3400 },
    allowance: 1000,
    notes: `${NFC} (Circular M, effective PP10 2026). Exemptions: 1 exemption = 4,400; n>1 = 1,000 x n + 3,400 (modeled as 3,400 + 1,000/allowance; with 0 exemptions there is NO 3,400). 4% millionaire surtax above 1,107,750 included. FICA/retirement contributions deductible up to 2,000/yr (not modeled). HOH credit 120 and blind credit 110 each subtracted from tax. No withholding if wages < 8,000 and >= 1 exemption. PFML out of scope.`,
  },

  MD: {
    year: 2026,
    source: "https://help.nfc.usda.gov/bulletins/2026/1783003892.htm",
    method: "brackets",
    brackets: {
      single: b([0, 0.02], [1000, 0.03], [2000, 0.04], [3000, 0.0475], [100000, 0.05], [125000, 0.0525], [150000, 0.055], [250000, 0.0575], [500000, 0.0625], [1000000, 0.065]),
      married: b([0, 0.02], [1000, 0.03], [2000, 0.04], [3000, 0.0475], [150000, 0.05], [175000, 0.0525], [225000, 0.055], [300000, 0.0575], [600000, 0.0625], [1200000, 0.065]),
    },
    standardDeduction: { single: 3400, married: 3400, head: 3400 },
    allowance: 3200,
    notes: `${NFC} (effective PP12 2026; std deduction 3,350->3,400 flat). NFC tables treat income up to 100k (S) / 150k (M) at 4.75% flat; the statutory 2%/3%/4% first-3,000 tiers are kept here (difference ~$52/yr). HOH uses married brackets on the return; single used here. Whether married gets a doubled flat deduction was not confirmed. COUNTY income tax (2.25%-3.30%, Anne Arundel/Frederick graduated) is withheld in addition and NOT included. Exemption phases down at high income on the return.`,
  },

  ME: {
    year: 2026,
    source: "https://help.nfc.usda.gov/bulletins/2026/1787745725.htm",
    method: "brackets",
    brackets: {
      single: b([0, 0.058], [27400, 0.0675], [64850, 0.0715], [1000000, 0.0915]),
      married: b([0, 0.058], [54850, 0.0675], [129750, 0.0715], [1500000, 0.0915]),
    },
    standardDeduction: { single: 12850, married: 28550 },
    allowance: 5300,
    notes: `${NFC} (effective PP17 2026). Standard deduction phases out: single over 102,250 -> (177,250 - wages)/75,000 x 12,850, 0 at 177,250+; married over 204,550 -> (354,550 - wages)/150,000 x 28,550, 0 at 354,550+. HOH not given (single used). New 2% surcharge bracket (9.15%) above 1M S / 1.5M M. Maine PFML out of scope.`,
  },

  MI: {
    year: 2026,
    source: "https://help.nfc.usda.gov/bulletins/2026/1781704387.htm",
    method: "flat",
    flatRate: 0.0425,
    allowance: 5900,
    notes: `${NFC} (effective PP12 2026). City income taxes (Detroit 2.4%, etc.) not included.`,
  },

  MN: {
    year: 2026,
    source: "https://help.nfc.usda.gov/bulletins/2026/1782924992.htm",
    method: "brackets",
    brackets: {
      single: b([0, 0], [4700, 0.0535], [38010, 0.068], [114130, 0.0785], [207850, 0.0985]),
      married: b([0, 0], [14700, 0.0535], [63400, 0.068], [208180, 0.0785], [352630, 0.0985]),
    },
    allowance: 5300,
    notes: `${NFC} (effective PP13 2026). HOH uses single table. Minnesota PFML (from 2026) out of scope.`,
  },

  MO: {
    year: 2026,
    source: "https://help.nfc.usda.gov/bulletins/2026/1773783048.htm",
    method: "brackets",
    brackets: { single: b([0, 0], [1348, 0.02], [2696, 0.025], [4044, 0.03], [5392, 0.035], [6740, 0.04], [8088, 0.045], [9436, 0.047]) },
    standardDeduction: { single: 16100, married: 32200, head: 24150 },
    notes: `${NFC} (effective PP08 2026). Standard deduction by MO W-4 status: Single/MFS/Married-spouse-works 16,100; Married-spouse-does-not-work 32,200 (stored); HOH 24,150. No allowances; no federal-tax deduction in current formula. Kansas City / St. Louis 1% earnings taxes not included.`,
  },

  MS: {
    year: 2026,
    source: "https://help.nfc.usda.gov/bulletins/2026/1768327516.htm",
    method: "brackets",
    brackets: { single: b([0, 0], [10000, 0.04]) },
    standardDeduction: { single: 2300, married: 4600, head: 3400 },
    personalExemption: { single: 6000, married: 12000, head: 9500 },
    allowance: 1500,
    notes: `${NFC} (effective PP09 2026; rate 4.4%->4.0%). Married-both-spouses-working uses std deduction 2,300 and splits the 12,000 exemption as claimed on Form 89-350. On 89-350 the employee actually enters total exemption DOLLARS (personal + 1,500 per dependent); modeled as automatic personal exemption + 1,500/allowance. No W-4 on file => 0 exemption.`,
  },

  MT: {
    year: 2026,
    source: "https://help.nfc.usda.gov/bulletins/2026/1767632355.htm",
    method: "brackets",
    brackets: {
      single: b([0, 0], [16100, 0.047], [63600, 0.0565]),
      married: b([0, 0], [32200, 0.047], [127200, 0.0565]),
      head: b([0, 0], [24150, 0.047], [95400, 0.0565]),
    },
    notes: `${NFC} (effective PP05 2026). Zero bracket = federal standard deduction. Single table also used for MFS and MFJ-both-spouses-working. Montana uses federal W-4 status; no state allowances.`,
  },

  NC: {
    year: 2026,
    source: "https://help.nfc.usda.gov/bulletins/2026/1767633224.htm",
    method: "flat",
    flatRate: 0.0409,
    standardDeduction: { single: 12750, married: 12750, head: 19125 },
    allowance: 2500,
    notes: `${NFC} (effective PP09 2026). Withholding rate 4.09% (statutory 2026 rate 3.99% + 0.10% NC withholding adjustment). Married uses half the MFJ deduction.`,
  },

  ND: {
    year: 2026,
    source: "https://help.nfc.usda.gov/bulletins/2026/1767646699.htm",
    method: "brackets",
    brackets: {
      single: b([0, 0], [57625, 0.0195], [258450, 0.025]),
      married: b([0, 0], [57500, 0.0195], [168525, 0.025]),
      head: b([0, 0], [78475, 0.0195], [289675, 0.025]),
    },
    allowance: 5050,
    notes: `${NFC} (effective PP13 2026). Uses federal W-4 status; the 5,050 allowance applies only to pre-2020 federal W-4s (none for 2020+ W-4). Brackets as printed by NFC (married first threshold printed as 57,500).`,
  },

  NE: {
    year: 2026,
    source: "https://help.nfc.usda.gov/bulletins/2026/1774374744.htm",
    method: "brackets",
    brackets: {
      single: b([0, 0], [3430, 0.0226], [6710, 0.0322], [21810, 0.0421], [31610, 0.0435], [40130, 0.0448], [75370, 0.046]),
      married: b([0, 0], [8190, 0.0226], [13010, 0.0322], [32400, 0.0421], [50400, 0.0435], [62530, 0.0448], [82920, 0.046]),
    },
    allowance: 2440,
    notes: `${NFC} (Circular EN, effective PP04 2026). HOH uses single table. Nebraska also requires minimum withholding of 50% of the table amount in some cases (not modeled).`,
  },

  NH: { year: 2026, source: "https://www.revenue.nh.gov/", method: "none", notes: "No tax on wages (interest & dividends tax repealed from 2025)." },

  NJ: {
    year: 2026,
    source: "https://nationaltaxtools.com/payroll/new-jersey/paycheck-calculator/",
    method: "brackets",
    brackets: {
      single: b([0, 0.015], [20000, 0.02], [35000, 0.039], [40000, 0.061], [75000, 0.07], [500000, 0.099], [1000000, 0.118]),
      married: b([0, 0.015], [20000, 0.02], [50000, 0.027], [70000, 0.039], [80000, 0.061], [150000, 0.07], [500000, 0.099], [1000000, 0.118]),
      head: b([0, 0.015], [20000, 0.02], [50000, 0.027], [70000, 0.039], [80000, 0.061], [150000, 0.07], [500000, 0.099], [1000000, 0.118]),
    },
    allowance: 1000,
    notes: "UNVERIFIED (Rate A/B cumulative amounts at $40k=$795 and $80k=$1,830 confirmed via secondary source; full schedules from the NJ-WT Rate A/B tables, official PDF not fetched). single = Rate A (Single, MFS); married and head = Rate B (MFJ/CU, HOH, QW). Employees may elect Rate Tables C, D, E via NJ-W4 wage chart (not modeled). SDI/FLI out of scope.",
  },

  NM: {
    year: 2026,
    source: "https://help.nfc.usda.gov/bulletins/2026/1776874663.htm",
    method: "brackets",
    brackets: {
      single: b([0, 0], [8050, 0.015], [13550, 0.032], [24550, 0.043], [41550, 0.047], [74550, 0.049], [218050, 0.059]),
      married: b([0, 0], [16100, 0.015], [24100, 0.032], [41100, 0.043], [66100, 0.047], [116100, 0.049], [331100, 0.059]),
      head: b([0, 0], [12075, 0.015], [20075, 0.032], [37075, 0.043], [62075, 0.047], [112075, 0.049], [327075, 0.059]),
    },
    notes: `${NFC} (effective PP11 2026). Zero bracket is the built-in withholding standard deduction. Uses federal W-4 status; no state allowances.`,
  },

  NV: { year: 2026, source: "https://tax.nv.gov/", method: "none", notes: "No state income tax." },

  NY: {
    year: 2026,
    source: "https://www.tax.ny.gov/pdf/publications/withholding/nys50_t_nys.pdf",
    method: "brackets",
    brackets: {
      single: b([0, 0.039], [8500, 0.044], [11700, 0.0515], [13900, 0.054], [80650, 0.059], [96800, 0.0703], [107650, 0.0753], [157650, 0.064], [215400, 0.1144], [265400, 0.0735], [1077550, 0.1045]),
      married: b([0, 0.039], [8500, 0.044], [11700, 0.0515], [13900, 0.054], [80650, 0.059], [96800, 0.0657], [107650, 0.0707], [157650, 0.0801], [211550, 0.064], [323200, 0.1349], [373200, 0.0735], [1077550, 0.0765], [2155350, 0.1045]),
    },
    standardDeduction: { single: 7400, married: 7950, head: 7400 },
    allowance: 1000,
    notes: "NYS-50-T-NYS (1/26), Exact Calculation Method, annual. Single table covers HOH. The odd marginal rates (e.g. 11.44%, 13.49%) are the official withholding schedule's built-in benefit recapture. Simplified: above $1,077,550 (S) / $2,155,350 (M) the official Method III taxes ALL net wages flat at 10.45%, rising to 11.10% above $5M and 11.70% above $25M - stored as marginal 10.45% (understates very high earners). Supplemental rate 11.70%. NYC and Yonkers withholding (NYS-50-T-NYC/Y) and NY PFL not included.",
  },

  OH: {
    year: 2026,
    source: "https://help.nfc.usda.gov/bulletins/2026/1786990318.htm",
    method: "brackets",
    brackets: { single: b([0, 0.016], [26050, 0.0299], [100000, 0.034]) },
    allowance: 650,
    notes: `${NFC} (effective PP17 2026). Withholding schedule rates differ from the 2026 return (flat 2.75% over $26,050). Exemption 650 each (IT-4). Municipal income taxes and school district taxes not included.`,
  },

  OK: {
    year: 2026,
    source: "https://help.nfc.usda.gov/bulletins/2026/1773324603.htm",
    method: "brackets",
    brackets: {
      single: b([0, 0], [10100, 0.025], [11250, 0.035], [13550, 0.045]),
      married: b([0, 0], [20200, 0.025], [22500, 0.035], [27100, 0.045]),
    },
    allowance: 1000,
    notes: `${NFC} (OW-2, effective PP03 2026). Zero bracket is the built-in standard deduction. HOH uses single table.`,
  },

  OR: {
    year: 2026,
    source: "https://help.nfc.usda.gov/bulletins/2026/1778117419.htm",
    method: "brackets",
    brackets: {
      single: b([0, 0.0475], [4550, 0.0675], [11400, 0.0875], [125000, 0.099]),
      married: b([0, 0.0475], [9100, 0.0675], [22800, 0.0875], [250000, 0.099]),
    },
    standardDeduction: { single: 2910, married: 5820 },
    allowanceCredit: 263,
    federalDeduction: true,
    notes: `${NFC} (ODR 150-206-436, effective PP16 2026). 'single' = single with <3 allowances; single with 3+ allowances uses the married table and 5,820 deduction. Annual federal withholding is subtracted, CAPPED at 8,750, cap reduced to 7,000/5,250/3,500/1,750/0 in 5,000 steps from 125,000 (S) / 250,000 (M); 0 above 145,000 / 290,000. Simplified: for wages < 50,000 the ODR table adds a fixed 263 base to the tax; for wages >= 50,000 the table drops the lower brackets (0 to 11,400/22,800, then 678/1,357 + 8.75%) - stored brackets are the marginal structure without the base. Allowance credit 263 each; one allowance is removed for single wages > 100,000, one (two if 2+ claimed) for married > 200,000. Statewide transit tax (0.1%), Portland Metro/Multnomah taxes and Paid Leave OR out of scope.`,
  },

  PA: {
    year: 2026,
    source: "https://www.revenue.pa.gov/",
    method: "flat",
    flatRate: 0.0307,
    notes: "UNVERIFIED this session (source is the PA DOR home page; withholding guide not fetched; 3.07% flat rate unchanged since 2004). No deductions or allowances. Local Earned Income Tax (EIT) and Local Services Tax, and Philadelphia wage tax, not included.",
  },

  RI: {
    year: 2026,
    source: "https://help.nfc.usda.gov/bulletins/2026/1772030778.htm",
    method: "brackets",
    brackets: { single: b([0, 0.0375], [82050, 0.0475], [186450, 0.0599]) },
    allowance: 1000,
    notes: `${NFC} (effective PP03 2026). Same table for all statuses. Allowance (1,000 per exemption as used in the NFC formula) is 0 when annualized wages exceed 290,800. RI TDI out of scope.`,
  },

  SC: {
    year: 2026,
    source: "https://help.nfc.usda.gov/bulletins/2026/1773173131.htm",
    method: "brackets",
    brackets: { single: b([0, 0], [3640, 0.03], [18230, 0.06]) },
    standardDeduction: { single: 7500, married: 7500, head: 7500 },
    allowance: 5000,
    notes: `${NFC} (effective PP03 2026). Standard deduction = LESSER of 10% of annual wages or 7,500, and ONLY if >= 1 exemption is claimed (stored as 7,500 max - caller should apply min(0.10 x wages, 7,500)). Exemption 5,000 each.`,
  },

  SD: { year: 2026, source: "https://dor.sd.gov/", method: "none", notes: "No state income tax." },
  TN: { year: 2026, source: "https://www.tn.gov/revenue.html", method: "none", notes: "No tax on wages." },
  TX: { year: 2026, source: "https://comptroller.texas.gov/", method: "none", notes: "No state income tax." },

  UT: {
    year: 2026,
    source: "https://help.nfc.usda.gov/bulletins/2026/1782763921.htm",
    method: "flat",
    flatRate: 0.0445,
    notes: `${NFC} (Pub 14, effective PP12 2026; rate 4.50%->4.45%). Not expressible in the shape: tax = wages x 4.45% minus a withholding allowance CREDIT of 485 (single) / 970 (married), which is reduced by 1.3% of annual wages above 9,348 (S) / 18,696 (M), not below 0. Uses federal W-4 status; no per-allowance amount.`,
  },

  VA: {
    year: 2026,
    source: "https://www.tax.virginia.gov/node/35195",
    method: "brackets",
    brackets: { single: b([0, 0.02], [3000, 0.03], [5000, 0.05], [17000, 0.0575]) },
    standardDeduction: { single: 8750, married: 8750, head: 8750 },
    allowance: 930,
    notes: "Virginia withholding formula for wages paid after July 1, 2025 (applies to 2026). Personal exemption 930 per VA-4 allowance; age 65+/blind exemptions 800 each. Standard deduction 8,750 per employee regardless of status; scheduled to revert to 3,000 after tax year 2026.",
  },

  VT: {
    year: 2026,
    source: "https://help.nfc.usda.gov/bulletins/2026/1780320782.htm",
    method: "brackets",
    brackets: {
      single: b([0, 0], [3925, 0.0335], [54675, 0.066], [126775, 0.076], [260225, 0.0875]),
      married: b([0, 0], [11775, 0.0335], [96475, 0.066], [216525, 0.076], [323825, 0.0875]),
    },
    allowance: 5400,
    notes: `${NFC} (effective PP09 2026). Single table also used for HOH.`,
  },

  WA: { year: 2026, source: "https://dor.wa.gov/", method: "none", notes: "No state income tax on wages. Paid Family & Medical Leave and WA Cares (LTC, 0.58%) payroll premiums are out of scope." },

  WI: {
    year: 2026,
    source: "https://nationaltaxtools.com/payroll/wisconsin/paycheck-calculator/",
    method: "brackets",
    brackets: { single: b([0, 0.0354], [12760, 0.0465], [25520, 0.053], [280950, 0.0765]) },
    standardDeduction: { single: 6702, married: 9461 },
    allowance: 400,
    notes: "UNVERIFIED (from a third-party summary of Pub W-166; official PDF not fetched). Same rate schedule for all statuses. Standard deduction is SLIDING: single 6,702 reduced by 12% of wages over 17,780 (0 at 73,630); married 9,461 reduced by 20% of wages over 25,727 (0 at 73,032). Stored values are maxima. Exemption deduction 400 each (WT-4).",
  },

  WV: {
    year: 2026,
    source: "https://help.nfc.usda.gov/bulletins/2026/1786455448.htm",
    method: "brackets",
    brackets: { single: b([0, 0.0211], [10000, 0.0281], [25000, 0.0316], [40000, 0.0422], [60000, 0.0458]) },
    allowance: 2000,
    notes: `${NFC} (effective PP14 2026). Stored table is the standard ('one earner/one job') schedule for all statuses. Optional two-earner/two-jobs schedule: 2.11% to 7,500; 2.81% to 18,750; 3.16% to 30,000; 4.22% to 45,000; 4.58% above.`,
  },

  WY: { year: 2026, source: "https://revenue.wyo.gov/", method: "none", notes: "No state income tax." },
};
