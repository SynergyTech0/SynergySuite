/**
 * Each state's trust-accounting and fee-agreement rules as numbers the app can check against,
 * carried over from synergylaw's jurisdiction rule engine. They are a firm's working guide, not
 * legal advice: every check links to the rule so a lawyer can confirm it, and a matter in a court
 * not listed here (federal courts included) gets no state checks.
 */
export type Jurisdiction = {
  code: string;
  name: string;
  /** Business days after receipt that client money must be in the trust account. */
  depositDays: number;
  /** Days between required trust account reconciliations. */
  reconcileDays: number;
  /** Years trust records must be kept. */
  retentionYears: number;
  /** Fees expected above this many dollars need a written agreement; 0 = always; null = no rule given. */
  writtenFeeOver: number | null;
  /** Highest contingency percentage the guide allows; null = no general cap. */
  maxContingencyPct: number | null;
  contingencyInWriting: boolean;
  citation: string;
  url: string;
};

type Row = [string, string, number, number, number, number | null, number | null, boolean, string, string];

const ROWS: Row[] = [
  ["AL","Alabama",1,30,6,1000,40,true,"Alabama Rules of Professional Conduct","https://judicial.alabama.gov/library/rules/cond1_15"],
  ["AK","Alaska",1,30,5,1000,33,true,"Alaska Rules of Professional Conduct","https://public.courts.alaska.gov/web/rules/docs/prof.pdf"],
  ["AZ","Arizona",1,30,5,1000,40,true,"Arizona Rules of Professional Conduct","https://www.azbar.org/for-lawyers/ethics/rules-of-professional-conduct/"],
  ["AR","Arkansas",1,30,5,500,40,true,"Arkansas Rules of Professional Conduct","https://www.arcourts.gov/rules-and-administrative-orders"],
  ["CA","California",1,30,5,1000,40,true,"California Rules of Professional Conduct","https://www.calbar.ca.gov/Attorneys/Conduct-Discipline/Rules/Rules-of-Professional-Conduct/Current-Rules/Rule-1-15"],
  ["CO","Colorado",1,30,7,500,40,true,"Colorado Rules of Professional Conduct","https://www.cobar.org/For-Members/Ethics-Resources/Rules-of-Professional-Conduct"],
  ["CT","Connecticut",1,30,7,500,33,true,"Connecticut Rules of Professional Conduct","https://www.jud.ct.gov/Publications/PracticeBook/PB.pdf"],
  ["DE","Delaware",1,30,5,1000,40,true,"Delaware Lawyers' Rules of Professional Conduct","https://courts.delaware.gov/rules/"],
  ["DC","District of Columbia",1,30,5,1000,40,true,"D.C. Rules of Professional Conduct","https://www.dcbar.org/for-lawyers/legal-ethics/rules-of-professional-conduct"],
  ["FL","Florida",1,30,6,0,40,true,"Rules Regulating The Florida Bar","https://www.floridabar.org/rules/rrtfb/"],
  ["GA","Georgia",1,30,6,500,40,true,"Georgia Rules of Professional Conduct","https://www.gabar.org/barrules/georgia-rules-of-professional-conduct.cfm"],
  ["HI","Hawaii",1,30,6,1000,40,true,"Hawaii Rules of Professional Conduct","https://www.courts.state.hi.us/docs/court_rules/rules/hrpcond.htm"],
  ["ID","Idaho",1,30,5,1000,40,true,"Idaho Rules of Professional Conduct","https://isb.idaho.gov/licensing-mcle/i-r-p-c/"],
  ["IL","Illinois",1,30,7,500,33,true,"Illinois Rules of Professional Conduct","https://www.isba.org/ethics"],
  ["IN","Indiana",1,30,5,1000,40,true,"Indiana Rules of Professional Conduct","https://www.in.gov/courts/rules/prof_conduct/"],
  ["IA","Iowa",1,30,6,500,40,true,"Iowa Rules of Professional Conduct","https://www.legis.iowa.gov/law/courtRules"],
  ["KS","Kansas",1,30,5,500,50,true,"Kansas Rules of Professional Conduct","https://www.kscourts.org/Rules-Orders/Supreme-Court-Rules"],
  ["KY","Kentucky",1,30,5,1000,40,true,"Kentucky Rules of Professional Conduct","https://kycourts.gov/courts/supreme/Rules_Procedures/Pages/default.aspx"],
  ["LA","Louisiana",1,30,5,500,40,true,"Louisiana Rules of Professional Conduct","https://www.lasc.org/rules/supreme/RulesList"],
  ["ME","Maine",1,30,6,1000,33,true,"Maine Rules of Professional Conduct","https://www.courts.maine.gov/rules_adminorders/rules/"],
  ["MD","Maryland",1,30,5,500,40,true,"Maryland Attorneys' Rules of Professional Conduct","https://www.mdcourts.gov/lawyers/rules"],
  ["MA","Massachusetts",3,60,6,500,40,true,"Massachusetts Rules of Professional Conduct","https://www.mass.gov/rules-of-professional-conduct"],
  ["MI","Michigan",1,30,5,1000,33,true,"Michigan Rules of Professional Conduct","https://courts.michigan.gov/courts/michigansupremecourt/rules"],
  ["MN","Minnesota",1,30,6,1000,33,true,"Minnesota Rules of Professional Conduct","https://www.revisor.mn.gov/court_rules/rule/profrpc-toc/"],
  ["MS","Mississippi",1,30,5,500,40,true,"Mississippi Rules of Professional Conduct","https://courts.ms.gov/rules/rules.php"],
  ["MO","Missouri",1,30,5,500,50,true,"Missouri Rules of Professional Conduct","https://www.courts.mo.gov/page.jsp?id=707"],
  ["MT","Montana",1,30,5,1000,40,true,"Montana Rules of Professional Conduct","https://courts.mt.gov/supremecourt/rules"],
  ["NE","Nebraska",1,30,5,500,40,true,"Nebraska Rules of Professional Conduct","https://supremecourt.nebraska.gov/nebraska-court-rules/chapter-3-attorneys-practice-law"],
  ["NV","Nevada",1,30,5,1000,40,true,"Nevada Rules of Professional Conduct","https://www.nvbar.org/member-services-3702/ethics-3702/"],
  ["NH","New Hampshire",1,30,6,500,33,true,"New Hampshire Rules of Professional Conduct","https://www.courts.nh.gov/our-courts/supreme-court/court-rules"],
  ["NJ","New Jersey",1,30,7,500,33,true,"New Jersey Rules of Professional Conduct","https://www.njcourts.gov/attorneys/rules-professional-conduct"],
  ["NM","New Mexico",1,30,5,500,40,true,"New Mexico Rules of Professional Conduct","https://nmonesource.com/nmos/nmra/en/nav.do"],
  ["NY","New York",1,30,7,3000,null,true,"New York Rules of Professional Conduct","https://nysba.org/attorney-resources/professional-standards/rules-of-professional-conduct/"],
  ["NC","North Carolina",1,30,6,500,40,true,"North Carolina Revised Rules of Professional Conduct","https://www.ncbar.gov/for-lawyers/ethics/"],
  ["ND","North Dakota",1,30,5,1000,40,true,"North Dakota Rules of Professional Conduct","https://www.ndcourts.gov/supreme-court/rules"],
  ["OH","Ohio",1,30,6,500,40,true,"Ohio Rules of Professional Conduct","https://www.supremecourt.ohio.gov/LegalResources/Rules/ProfConduct/"],
  ["OK","Oklahoma",1,30,5,500,50,true,"Oklahoma Rules of Professional Conduct","https://www.okbar.org/ec/orpc/"],
  ["OR","Oregon",1,30,5,1000,40,true,"Oregon Rules of Professional Conduct","https://www.osbar.org/rulesregs/regelations.html"],
  ["PA","Pennsylvania",1,30,5,1000,40,true,"Pennsylvania Rules of Professional Conduct","https://www.pacodeandbulletin.gov/Display/pacode?file=/secure/pacode/data/204/chapter81/chap81toc.html"],
  ["RI","Rhode Island",1,30,5,500,33,true,"Rhode Island Rules of Professional Conduct","https://www.courts.ri.gov/Courts/Attorneydiscipline/Pages/default.aspx"],
  ["SC","South Carolina",1,30,6,500,40,true,"South Carolina Rules of Professional Conduct","https://www.sccourts.org/courtReg/"],
  ["SD","South Dakota",1,30,5,1000,40,true,"South Dakota Rules of Professional Conduct","https://ujs.sd.gov/Supreme_Court/Rules.aspx"],
  ["TN","Tennessee",1,30,5,500,40,true,"Tennessee Rules of Professional Conduct","https://www.tncourts.gov/rules/supreme-court/8"],
  ["TX","Texas",1,30,5,null,null,true,"Texas Disciplinary Rules of Professional Conduct","https://www.texasbar.com/"],
  ["UT","Utah",1,30,5,1000,40,true,"Utah Rules of Professional Conduct","https://www.utcourts.gov/rules/view.php?type=ucja&rule=13"],
  ["VT","Vermont",1,30,6,500,33,true,"Vermont Rules of Professional Conduct","https://www.vermontjudiciary.org/about-vermont-judiciary/rules-and-forms"],
  ["VA","Virginia",1,30,5,500,40,true,"Virginia Rules of Professional Conduct","https://www.vsb.org/pro-guidelines/index.php/rules/"],
  ["WA","Washington",1,30,5,500,40,true,"Washington Rules of Professional Conduct","https://www.courts.wa.gov/court_rules/?fa=court_rules.list&group=ga&set=RPC"],
  ["WV","West Virginia",1,30,5,500,40,true,"West Virginia Rules of Professional Conduct","https://www.wvbar.org/office-of-disciplinary-counsel/rules-of-professional-conduct/"],
  ["WI","Wisconsin",1,30,6,1000,40,true,"Wisconsin Rules of Professional Conduct for Attorneys","https://www.wicourts.gov/services/attorney/rules.htm"],
  ["WY","Wyoming",1,30,5,1000,40,true,"Wyoming Rules of Professional Conduct","https://www.courts.state.wy.us/supreme-court/rules/"],
];

export const JURISDICTIONS: Jurisdiction[] = ROWS.map(([code, name, depositDays, reconcileDays, retentionYears, writtenFeeOver, maxContingencyPct, contingencyInWriting, citation, url]) => ({
  code, name, depositDays, reconcileDays, retentionYears, writtenFeeOver, maxContingencyPct, contingencyInWriting, citation, url,
}));

const BY_CODE = new Map(JURISDICTIONS.map((j) => [j.code, j]));

/** Where a matter can be: a state, or a federal court (FED), which has no state checks. */
export const CODES = ["FED", ...JURISDICTIONS.map((j) => j.code)];

export function jurisdiction(code: string | null | undefined): Jurisdiction | null {
  return BY_CODE.get(String(code ?? "").toUpperCase()) ?? null;
}

export function jurisdictionName(code: string): string {
  return code === "FED" ? "Federal" : (jurisdiction(code)?.name ?? code);
}

export type Check = { level: "warn" | "ok"; rule: string; message: string; citation: string; url: string };

type MatterTerms = {
  jurisdiction: string;
  fee_type: string;
  contingency_pct: number | string | null;
  flat_cents: number | string | null;
  engagement_signed_on: string | null;
  billed_cents?: number;
};

/** How a matter's fee terms sit against its state's rules. */
export function matterChecks(m: MatterTerms): Check[] {
  const j = jurisdiction(m.jurisdiction);
  if (!j) return [];
  const out: Check[] = [];
  const cite = { citation: j.citation, url: j.url };
  const signed = !!m.engagement_signed_on;
  if (m.fee_type === "contingency") {
    const pct = m.contingency_pct === null ? null : Number(m.contingency_pct);
    if (j.contingencyInWriting && !signed) {
      out.push({ level: "warn", rule: "Contingency fee in writing", message: `${j.name} wants a contingency fee agreed in writing and signed by the client. Record the date it was signed.`, ...cite });
    }
    if (j.maxContingencyPct !== null && pct !== null && pct > j.maxContingencyPct) {
      out.push({ level: "warn", rule: "Contingency percentage", message: `${pct}% is above the ${j.maxContingencyPct}% this guide has for ${j.name}. Check the rule before agreeing it.`, ...cite });
    }
  } else if (m.fee_type !== "pro_bono" && j.writtenFeeOver !== null && !signed) {
    const expected = Math.max(Number(m.flat_cents ?? 0), m.billed_cents ?? 0) / 100;
    if (j.writtenFeeOver === 0 || expected > j.writtenFeeOver) {
      out.push({
        level: "warn",
        rule: "Written fee agreement",
        message: j.writtenFeeOver === 0
          ? `${j.name} expects a written fee agreement. Record the date the engagement letter was signed.`
          : `Fees here are over $${j.writtenFeeOver.toLocaleString()}, where ${j.name} expects a written fee agreement. Record the date the engagement letter was signed.`,
        ...cite,
      });
    }
  }
  return out;
}

/** Business days from `from` to `to` (both YYYY-MM-DD), not counting `from`, skipping weekends. */
export function businessDaysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (b <= a) return 0;
  let n = 0;
  for (let t = a + 86_400_000; t <= b; t += 86_400_000) {
    const d = new Date(t).getUTCDay();
    if (d !== 0 && d !== 6) n++;
  }
  return n;
}
