// Tests usage-line formatting for agent runner completion summaries.
import { describe, expect, it } from "vitest";
import { getReplyPayloadMetadata, setReplyPayloadMetadata } from "../reply-payload.js";
import { appendUsageLine } from "./agent-runner-usage-line.js";

describe("appendUsageLine", () => {
  const footer = "deepseek-flash  [█░░░░░░░░░] 10%\n↑0.0131$  Σ0.096$  @98.2%";

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

  it("leaves closed fences alone and unwraps the usage template's own text fence", () => {
    const text = "Result\n```text\nexample\n```";
    const template = "\n```text\n\n" + footer + "\n\n```\n";
    expect(appendUsageLine([{ text }], template)).toEqual([{ text: `${text}\n${footer}` }]);
  });

  it("keeps the footer on the answer when warnings and progress follow it", () => {
    const warning = { text: "⚠️ 工具已连续失败 3 次。", isError: true };
    const progress = { text: "Compacting…", isStatusNotice: true };
    expect(appendUsageLine([{ text: "Answer" }, warning, progress], footer)).toEqual([
      { text: `Answer\n${footer}` },
      warning,
      progress,
    ]);
    expect(appendUsageLine([warning, progress], footer)).toEqual([warning, progress]);
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
