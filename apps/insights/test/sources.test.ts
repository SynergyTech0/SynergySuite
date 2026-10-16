import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { config, readerPassword } from "@/lib/config";
import { grantReader, isSecretColumn } from "@/lib/sources";

describe("secret columns", () => {
  it("leaves out anything that looks like a credential", () => {
    for (const col of ["password", "passwordHash", "password_hash", "resetToken", "token_hash", "api_key", "apiKey", "secretKeyEncrypted",
      "webhookSecret", "plaidAccessToken", "eftpsPin", "pin", "mfa_secret_enc", "salt", "otp", "account_number", "iban"]) {
      expect(isSecretColumn(col), col).toBe(true);
    }
  });

  it("keeps ordinary business columns", () => {
    for (const col of ["id", "name", "total", "amount", "customer", "issuedAt", "stage", "email", "footprint", "shipping_address", "description", "company"]) {
      expect(isSecretColumn(col), col).toBe(false);
    }
  });
});

const url = process.env.TEST_DATABASE_URL;
const db = `insights_src_${process.pid}`;
const role = `insights_reader_${process.pid}`;

describe.skipIf(!url)("read-only grants", () => {
  const root = (url ?? "").replace(/\/[^/@]*$/, "");
  const c = config({ INSIGHTS_PG_URL: url, INSIGHTS_SECRET: "test", INSIGHTS_READER_ROLE: role });
  const admin = new Client({ connectionString: url });

  beforeAll(async () => {
    await admin.connect();
    await admin.query(`CREATE DATABASE ${db}`);
    const src = new Client({ connectionString: `${root}/${db}` });
    await src.connect();
    await src.query(`
      CREATE TABLE invoices (id int, customer text, total numeric);
      INSERT INTO invoices VALUES (1, 'Acme', 100);
      CREATE TABLE users (id int, email text, password_hash text, "resetToken" text);
      INSERT INTO users VALUES (1, 'a@x.com', 'h', 't');
      CREATE TABLE secrets (api_key text);
      CREATE SCHEMA extra;
      CREATE TABLE extra.notes (id int, body text);
      INSERT INTO extra.notes VALUES (1, 'hello');`);
    await src.end();
  });

  afterAll(async () => {
    await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await admin.query(`DROP ROLE IF EXISTS ${role}`);
    await admin.end();
  });

  async function asReader<T>(fn: (cl: Client) => Promise<T>): Promise<T> {
    const u = new URL(`${root}/${db}`);
    u.username = role;
    u.password = readerPassword(c);
    const cl = new Client({ connectionString: u.toString() });
    await cl.connect();
    try {
      return await fn(cl);
    } finally {
      await cl.end();
    }
  }

  it("grants every safe column and nothing else, and can't write", async () => {
    const r = await grantReader(c, db);
    expect(r.tables).toBe(4);
    expect(r.hiddenColumns.sort()).toEqual(["secrets.api_key", "users.password_hash", "users.resetToken"]);
    await asReader(async (cl) => {
      expect((await cl.query("SELECT customer FROM invoices")).rows).toEqual([{ customer: "Acme" }]);
      expect((await cl.query("SELECT id, email FROM users")).rows).toEqual([{ id: 1, email: "a@x.com" }]);
      expect((await cl.query("SELECT body FROM extra.notes")).rows).toEqual([{ body: "hello" }]);
      await expect(cl.query("SELECT password_hash FROM users")).rejects.toThrow(/permission denied/);
      await expect(cl.query("SELECT * FROM users")).rejects.toThrow(/permission denied/);
      await expect(cl.query("SELECT * FROM secrets")).rejects.toThrow(/permission denied/);
      await expect(cl.query("UPDATE invoices SET total = 0")).rejects.toThrow(/read-only|permission denied/);
      await expect(cl.query("CREATE TABLE public.x (id int)")).rejects.toThrow(/read-only|permission denied/);
    });
  });

  it("catches a secret column added after a full grant, on the next sync", async () => {
    await grantReader(c, db);
    const src = new Client({ connectionString: `${root}/${db}` });
    await src.connect();
    await src.query("ALTER TABLE invoices ADD COLUMN payment_token text");
    await src.end();
    const r = await grantReader(c, db);
    expect(r.hiddenColumns).toContain("invoices.payment_token");
    await asReader(async (cl) => {
      await expect(cl.query("SELECT payment_token FROM invoices")).rejects.toThrow(/permission denied/);
      expect((await cl.query("SELECT total FROM invoices")).rows).toHaveLength(1);
    });
  });
});
