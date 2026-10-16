import type { W2 } from "./forms";

/**
 * The W-2 file the Social Security Administration takes through Business Services Online: EFW2,
 * 512-character records RA (submitter), RE (employer), one RW per employee, RT (totals for the
 * employer) and RF (end of file), each followed by CR LF. Layout from SSA Publication 42-007,
 * "Specifications for Filing Forms W-2 Electronically", tax year 2025 edition. Run a file through
 * SSA's AccuWage Online before the first upload of a new tax year.
 */

export interface Efw2Address { address1: string; address2: string; city: string; state: string; zip: string }

export interface Efw2Employer extends Efw2Address {
  ein: string;
  name: string;
  /** SSA Business Services Online user ID of whoever uploads the file. */
  bsoUserId: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  /** This is the last year W-2s will be filed under this EIN. */
  terminating?: boolean;
}

export interface Efw2Employee extends Efw2Address {
  ssn: string;
  first: string;
  middle: string;
  last: string;
  suffix: string;
  w2: W2;
}

const RECORD = 512;

function clean(s: string): string {
  return s.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z0-9 .,'&/#-]/g, "").replace(/\s+/g, " ").trim();
}
const alpha = (s: string, n: number) => clean(s ?? "").slice(0, n).padEnd(n, " ");
/** Mixed case allowed: only e-mail fields. */
const raw = (s: string, n: number) => (s ?? "").trim().slice(0, n).padEnd(n, " ");
const digits = (s: string, n: number) => (s ?? "").replace(/\D/g, "").slice(0, n).padEnd(n, " ");
const money = (cents: number, n: number) => {
  const v = Math.max(0, Math.round(cents || 0));
  const s = String(v);
  if (s.length > n) throw new Error(`${(v / 100).toFixed(2)} does not fit the W-2 file`);
  return s.padStart(n, "0");
};
const blank = (n: number) => " ".repeat(n);
const zip5 = (z: string) => digits(z, 9).slice(0, 5);
const zip4 = (z: string) => digits(z, 9).slice(5, 9).padEnd(4, " ");

/** Location (suite) and delivery (street) address, city, state and ZIP: same order in RA, RE, RW. */
function address(a: Efw2Address): string {
  return alpha(a.address2, 22) + alpha(a.address1, 22) + alpha(a.city, 22) + alpha(a.state, 2) + zip5(a.zip) + zip4(a.zip);
}

/** What's missing before SSA will take the file, in plain words. */
export function efw2Problems(employer: Efw2Employer, employees: Efw2Employee[]): string[] {
  const out: string[] = [];
  if (!/^\d{9}$/.test(employer.ein)) out.push("the company's EIN");
  if (!/^[A-Z0-9]{8}$/i.test(employer.bsoUserId)) out.push("the BSO user ID");
  if (!employer.name) out.push("the company's legal name");
  if (!employer.address1 || !employer.city || !employer.state || !employer.zip) out.push("the company's address");
  if (!employer.contactName || !employer.contactPhone || !employer.contactEmail) out.push("the W-2 contact's name, phone and email");
  for (const e of employees) {
    const who = `${e.first} ${e.last}`.trim() || e.w2.employeeId;
    if (!/^\d{9}$/.test(e.ssn)) out.push(`${who}'s Social Security number`);
    if (!e.first || !e.last) out.push(`${who}'s legal name`);
    if (!e.address1 || !e.city || !e.state || !e.zip) out.push(`${who}'s address`);
  }
  return out;
}

const RW_BOX12: [string, number][] = [["D", 287], ["E", 298], ["F", 309], ["G", 320], ["H", 331], ["W", 364], ["Q", 386], ["C", 408], ["V", 419], ["Y", 430], ["AA", 441], ["BB", 452], ["DD", 463], ["FF", 474]];

export function buildEfw2(year: number, employer: Efw2Employer, employees: Efw2Employee[]): string {
  const problems = efw2Problems(employer, employees);
  if (problems.length) throw new Error(`The W-2 file needs ${problems.join(", ")}`);
  if (!employees.length) throw new Error(`Nobody was paid in ${year}`);
  const records: string[] = [];
  const ein = employer.ein;

  // RA: submitter (the employer files for itself), software code 98 = in-house.
  records.push(
    "RA" + ein + alpha(employer.bsoUserId, 8) + blank(4) + blank(5) + "0" + blank(6) + "98"
      + alpha(employer.name, 57) + address(employer) + blank(5) + blank(23) + blank(15) + blank(2)
      + alpha(employer.name, 57) + address(employer) + blank(5) + blank(23) + blank(15) + blank(2)
      + alpha(employer.contactName, 27) + digits(employer.contactPhone, 15) + blank(5) + blank(3) + raw(employer.contactEmail, 40)
      + blank(3) + blank(10) + blank(1) + "L" + blank(12),
  );
  // RE: employer. Kind N (none of the government or 501(c) kinds), employment code R (Form 941).
  records.push(
    "RE" + String(year) + blank(1) + ein + blank(9) + (employer.terminating ? "1" : "0") + blank(4) + blank(9)
      + alpha(employer.name, 57) + address(employer) + "N" + blank(4) + blank(23) + blank(15) + blank(2)
      + "R" + blank(1) + "0" + alpha(employer.contactName, 27) + digits(employer.contactPhone, 15) + blank(5) + blank(10)
      + raw(employer.contactEmail, 40) + blank(194),
  );

  const totals = new Map<number, number>();
  const add = (rtPos: number, cents: number) => totals.set(rtPos, (totals.get(rtPos) ?? 0) + cents);
  for (const e of employees) {
    const w = e.w2;
    const rw = Array.from({ length: RECORD }, () => " ");
    const put = (pos: number, s: string) => { for (let i = 0; i < s.length; i++) rw[pos - 1 + i] = s[i]; };
    put(1, "RW");
    put(3, e.ssn);
    put(12, alpha(e.first, 15) + alpha(e.middle, 15) + alpha(e.last, 20) + alpha(e.suffix, 4));
    put(66, address(e) + blank(5) + blank(23) + blank(15) + blank(2));
    const m = (pos: number, cents: number) => put(pos, money(cents, 11));
    m(188, w.wagesCents); m(199, w.federalCents); m(210, w.socialSecurityWagesCents); m(221, w.socialSecurityCents);
    m(232, w.medicareWagesCents); m(243, w.medicareCents); m(254, 0); m(276, 0);
    for (const [code, pos] of RW_BOX12) m(pos, w.box12[code] ?? 0);
    m(353, 0); m(375, 0);
    put(486, "0" + " " + (w.retirementPlan ? "1" : "0") + "0");
    const line = rw.join("");
    if (line.length !== RECORD) throw new Error("W-2 record is the wrong length");
    records.push(line);
    add(10, w.wagesCents); add(25, w.federalCents); add(40, w.socialSecurityWagesCents); add(55, w.socialSecurityCents);
    add(70, w.medicareWagesCents); add(85, w.medicareCents);
    add(145, w.box12.D ?? 0); add(160, w.box12.E ?? 0); add(250, w.box12.W ?? 0); add(295, w.box12.DD ?? 0); add(310, w.box12.C ?? 0);
    add(370, w.box12.AA ?? 0); add(385, w.box12.BB ?? 0);
  }

  // RT: totals of every RW under this RE; money fields are 15 characters, unused ones zero.
  const rt = Array.from({ length: RECORD }, () => " ");
  const putRt = (pos: number, s: string) => { for (let i = 0; i < s.length; i++) rt[pos - 1 + i] = s[i]; };
  putRt(1, "RT" + String(employees.length).padStart(7, "0"));
  const moneyPositions = [10, 25, 40, 55, 70, 85, 100, 130, 145, 160, 175, 190, 205, 235, 250, 265, 280, 295, 310, 325, 340, 355, 370, 385, 400];
  for (const pos of moneyPositions) putRt(pos, money(totals.get(pos) ?? 0, 15));
  records.push(rt.join(""));

  records.push("RF" + blank(5) + String(employees.length).padStart(9, "0") + blank(496));
  for (const r of records) if (r.length !== RECORD) throw new Error(`${r.slice(0, 2)} record is ${r.length} characters, not ${RECORD}`);
  return records.map((r) => r + "\r\n").join("");
}
