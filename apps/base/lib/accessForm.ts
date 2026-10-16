import { HttpError } from "./http";
import { MAX_ACCESS_BYTES } from "./access";

/** The file and password from an Access import form (multipart: `file`, optional `password`). */
export async function accessUpload(req: Request): Promise<{ name: string; buffer: Buffer; password?: string }> {
  const size = Number(req.headers.get("content-length") ?? 0);
  if (size > MAX_ACCESS_BYTES + 1024 * 1024) throw new HttpError(413, "Access files up to 100 MB can be imported");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") throw new HttpError(400, "Choose an .accdb or .mdb file");
  const password = form?.get("password");
  return {
    name: file.name.replace(/\.(accdb|mdb|accde|mde)$/i, "") || "Database",
    buffer: Buffer.from(await file.arrayBuffer()),
    password: typeof password === "string" && password ? password : undefined,
  };
}
