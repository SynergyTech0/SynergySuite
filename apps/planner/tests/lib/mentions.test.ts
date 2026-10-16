import { describe, expect, it } from "vitest";
import { activeMentionQuery, mentionToken, mentionsToMarkdown, splitMentions } from "@/lib/mentions";
import { mentionedIds, plainMentions } from "@/lib/notify";

const U = "0b5d9a3e-2c1f-4b6e-9f00-1234567890ab";

describe("mention tokens", () => {
  it("round-trips: the client builds a token the server recognises", () => {
    const text = `ping ${mentionToken("Carol Diaz", U)} please`;
    expect([...mentionedIds(text)]).toEqual([U]);
    expect(plainMentions(text)).toBe("ping @Carol Diaz please");
  });

  it("strips characters from the name that would break the token", () => {
    expect(mentionToken("we]ird\nname", U)).toBe(`@[weirdname](${U})`);
  });

  it("splits text into plain runs and mentions", () => {
    expect(splitMentions(`a ${mentionToken("Bo", U)} b`)).toEqual([
      { text: "a " }, { mention: "Bo", userId: U }, { text: " b" },
    ]);
  });

  it("shows mentions as bold in markdown instead of a link to a uuid", () => {
    expect(mentionsToMarkdown(`owner ${mentionToken("Bo", U)}`)).toBe("owner **@Bo**");
  });

  it("does not treat an email address or a plain @word as a mention for notification", () => {
    expect(mentionedIds("mail bob@example.com or @bob").size).toBe(0);
  });
});

describe("activeMentionQuery", () => {
  it("finds the @partial at the caret", () => {
    expect(activeMentionQuery("hey @ca", 7)).toEqual({ start: 4, query: "ca" });
    expect(activeMentionQuery("@", 1)).toEqual({ start: 0, query: "" });
  });

  it("ignores an @ inside a word, such as an email address", () => {
    expect(activeMentionQuery("bob@exa", 7)).toBeNull();
  });
});
