// Shapes shared by the server and the browser.

export type Labeled = { label: string; value: string };
export type Address = { label: string; street: string; city: string; region: string; postcode: string; country: string };

export type ContactInput = {
  firstName: string;
  lastName: string;
  middleName: string;
  nickname: string;
  company: string;
  jobTitle: string;
  department: string;
  emails: Labeled[];
  phones: Labeled[];
  addresses: Address[];
  websites: Labeled[];
  birthday: string; // YYYY-MM-DD or ""
  notes: string;
};

export type Contact = ContactInput & {
  id: string;
  displayName: string;
  favorite: boolean;
  hasPhoto: boolean;
  groups: string[];
  createdAt: string;
  modifiedAt: string;
};

export type Group = { id: string; name: string; count: number };

/** Someone in the organization: their suite account plus the profile they keep themselves. */
export type Person = {
  email: string;
  name: string;
  jobTitle: string;
  department: string;
  office: string;
  phone: string;
  mobile: string;
  manager: string;
  about: string;
  hasPhoto: boolean;
};

export const EMPTY_CONTACT: ContactInput = {
  firstName: "", lastName: "", middleName: "", nickname: "", company: "", jobTitle: "", department: "",
  emails: [], phones: [], addresses: [], websites: [], birthday: "", notes: "",
};

/** "Ada Lovelace", or the company, email or phone when there is no name. */
export function displayName(c: Pick<ContactInput, "firstName" | "middleName" | "lastName" | "nickname" | "company" | "emails" | "phones">): string {
  const name = [c.firstName, c.middleName, c.lastName].filter(Boolean).join(" ").trim();
  return name || c.nickname || c.company || c.emails[0]?.value || c.phones[0]?.value || "Unnamed contact";
}
