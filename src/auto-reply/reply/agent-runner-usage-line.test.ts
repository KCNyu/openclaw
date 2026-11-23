// Tests usage-line formatting for agent runner completion summaries.
import { describe, expect, it } from "vitest";
import { getReplyPayloadMetadata, setReplyPayloadMetadata } from "../reply-payload.js";
import { appendUsageLine } from "./agent-runner-usage-line.js";

describe("appendUsageLine", () => {
  const footer = "\n```text\ndeepseek-flash  [█░░░░░░░░░] 10%\n↑0.0131$  Σ0.096$  @98.2%\n```";

  it.each(["```text", "  ````text", "~~~text"])(
    "closes an open %s fence before the footer",
    (open) => {
      const text = `Result\n${open}\nexample`;
      const close = open.replace(/text$/, "");
      expect(appendUsageLine([{ text }], footer)).toEqual([
        { text: `${text}\n${close}\n${footer}` },
      ]);
    },
  );

  it.each(["Answer", "Result\n```text\nexample\n```"])(
    "preserves the template's two-line text block after %j",
    (text) => {
      expect(appendUsageLine([{ text }], footer)).toEqual([{ text: `${text}\n${footer}` }]);
    },
  );

  it("preserves the template's text block in a standalone footer", () => {
    expect(appendUsageLine([], footer)).toEqual([{ text: footer, isStatusNotice: true }]);
  });

  it("skips errors, reasoning, commentary and status notices when placing the footer", () => {
    const warning = { text: "⚠️ 工具已连续失败 3 次。", isError: true };
    const progress = { text: "Compacting…", isStatusNotice: true };
    const reasoning = { text: "Reasoning", isReasoning: true };
    const commentary = { text: "Commentary", isCommentary: true };
    const notices = [warning, progress, reasoning, commentary];
    expect(appendUsageLine([{ text: "Answer" }, ...notices], footer)).toEqual([
      { text: `Answer\n${footer}` },
      ...notices,
    ]);
    for (const notice of notices) {
      expect(appendUsageLine([notice], footer)).toEqual([notice]);
    }
  });

  it("preserves reply payload metadata when appending usage text", () => {
    const payload = setReplyPayloadMetadata(
      { text: "message tool reply" },
      {
        deliverDespiteSourceReplySuppression: true,
        sourceReplyTranscriptMirror: {
          sessionKey: "agent:main:telegram:direct:123",
          agentId: "main",
          text: "message tool reply",
          idempotencyKey: "run-1:internal-source-reply:0",
        },
      },
    );

    const [updated] = appendUsageLine([payload], "Usage: 12 in / 3 out");

    expect(updated).toEqual({ text: "message tool reply\nUsage: 12 in / 3 out" });
    expect(getReplyPayloadMetadata(updated)).toMatchObject({
      deliverDespiteSourceReplySuppression: true,
      sourceReplyTranscriptMirror: {
        sessionKey: "agent:main:telegram:direct:123",
        idempotencyKey: "run-1:internal-source-reply:0",
        text: "message tool reply\nUsage: 12 in / 3 out",
      },
    });
  });
});
