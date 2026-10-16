/** Browser side of Access import: sends the file, asking for the database password if it has one. */
import type { DatabaseInfo, TableInfo } from "./catalog";

export type AccessResult = { database?: DatabaseInfo; tables: TableInfo[]; records: number; notes: string[] };

export async function uploadAccess(url: string, file: File): Promise<AccessResult | null> {
  let password = "";
  for (;;) {
    const form = new FormData();
    form.set("file", file);
    if (password) form.set("password", password);
    const res = await fetch(url, { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data as AccessResult;
    const message = data.error || `Import failed (${res.status})`;
    if (/password/i.test(message)) {
      const answer = prompt(`${message}.\n\nPassword for ${file.name}:`);
      if (!answer) return null;
      password = answer;
      continue;
    }
    throw new Error(message);
  }
}

/** One line saying what an import brought in. */
export function summary(r: AccessResult): string {
  const n = r.tables.length;
  return `Imported ${n} table${n === 1 ? "" : "s"} and ${r.records.toLocaleString("en-US")} record${r.records === 1 ? "" : "s"} from Access.`;
}
