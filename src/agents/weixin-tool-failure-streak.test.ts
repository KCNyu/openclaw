import { afterEach, describe, expect, it, vi } from "vitest";
import { recordWeixinToolResult } from "./weixin-tool-failure-streak.js";

afterEach(() => vi.useRealTimers());

describe("Weixin tool failure streaks", () => {
  it("alerts once at three consecutive failures across turns and resets on success", () => {
    const results = (runId: string, failed = true) =>
      recordWeixinToolResult({ session: "retry-session", runId, failed });

    expect(results("turn-1")).toBe("quiet");
    expect(results("turn-2")).toBe("quiet");
    expect(results("turn-3")).toEqual({ consecutiveFailures: 3 });
    expect(results("turn-3")).toEqual({ consecutiveFailures: 4 });
    expect(results("turn-4")).toBe("quiet");
    expect(results("turn-4", false)).toBeUndefined();
    expect(results("turn-4")).toBe("quiet");
    expect(results("turn-4")).toBe("quiet");
    expect(results("turn-4")).toEqual({ consecutiveFailures: 3 });
  });

  it("isolates sessions and expires isolated failures after ten minutes", () => {
    vi.useFakeTimers();
    const record = (session: string) =>
      recordWeixinToolResult({ session, runId: "run", failed: true });

    expect(record("stale-session")).toBe("quiet");
    expect(record("stale-session")).toBe("quiet");
    expect(record("other-session")).toBe("quiet");
    vi.advanceTimersByTime(10 * 60_000);
    expect(record("stale-session")).toBe("quiet");
  });
});
