import { describe, expect, it } from "vitest";
import { POST as searchPost } from "../app/api/compliance/search/route";
import { POST as exportPost } from "../app/api/compliance/export/route";

process.env.COMPLIANCE_TOKEN = "t0ken";

const post = (body: string, auth?: string) =>
  new Request("http://mail.example.com/api/compliance/x", { method: "POST", body, headers: auth ? { authorization: auth } : {} });

describe("compliance routes", () => {
  it("need the compliance token", async () => {
    for (const handler of [searchPost, exportPost]) {
      expect((await handler(post("{}"))).status).toBe(401);
      expect((await handler(post("{}", "Bearer wrong"))).status).toBe(401);
    }
  });

  it("refuse bad input before touching any mailbox", async () => {
    const auth = "Bearer t0ken";
    expect((await searchPost(post("not json", auth))).status).toBe(400);
    expect((await searchPost(post('{"limit":-1}', auth))).status).toBe(400);
    expect((await searchPost(post('{"cursor":"nope"}', auth))).status).toBe(400);
    expect((await exportPost(post('{"ids":[]}', auth))).status).toBe(400);
    expect((await exportPost(post('{"ids":["l.garbage"]}', auth))).status).toBe(400);
    expect((await exportPost(post(JSON.stringify({ ids: Array(101).fill("p.x") }), auth))).status).toBe(400);
  });

  it("answers no hits for kinds Mail doesn't have", async () => {
    const res = await searchPost(post('{"kinds":["file"]}', "Bearer t0ken"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ app: "mail", hits: [] });
  });
});
