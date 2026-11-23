// Cron notification tests protect completion-delivery warning behavior,
// including URL redaction for invalid webhook destinations.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../cli/deps.types.js";
import type { CronJob } from "../cron/types.js";

const mocks = vi.hoisted(() => ({
  fetchWithSsrFGuard: vi.fn(async (_request: unknown) => ({ release: vi.fn() })),
  sendCronAnnouncePayloadStrict: vi.fn(async () => undefined),
  sendFailureNotificationAnnounce: vi.fn(),
}));

vi.mock("../infra/net/fetch-guard.js", () => ({
  fetchWithSsrFGuard: mocks.fetchWithSsrFGuard,
}));

vi.mock("../cron/delivery.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../cron/delivery.js")>();
  return {
    ...actual,
    sendCronAnnouncePayloadStrict: mocks.sendCronAnnouncePayloadStrict,
    sendFailureNotificationAnnounce: mocks.sendFailureNotificationAnnounce,
  };
});

import {
  dispatchGatewayCronFinishedNotifications,
  sendGatewayCronFailureAlert,
} from "./server-cron-notifications.js";

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new Error(`expected ${label}`);
  }
  return value as Record<string, unknown>;
}

function webhookRequestBody() {
  const call = (mocks.fetchWithSsrFGuard.mock.calls as unknown[][])[0];
  if (!call) {
    throw new Error("expected webhook request call");
  }
  const request = requireRecord(call[0], "webhook request");
  const init = requireRecord(request.init, "webhook request init");
  if (typeof init.body !== "string") {
    throw new Error("expected webhook request body");
  }
  return JSON.parse(init.body);
}

describe("dispatchGatewayCronFinishedNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redacts invalid completion webhook targets in warnings", () => {
    const logger = {
      warn: vi.fn(),
    };
    const job = {
      id: "cron-redact",
      name: "redact",
      enabled: true,
      createdAtMs: 1,
      updatedAtMs: 1,
      schedule: { kind: "every", everyMs: 60_000 },
      sessionTarget: "isolated",
      wakeMode: "next-heartbeat",
      payload: { kind: "agentTurn", message: "hello" },
      delivery: {
        mode: "announce",
        completionDestination: {
          mode: "webhook",
          to: "ftp://user:secret@example.invalid/hook?token=secret",
        },
      },
      state: {},
    } satisfies CronJob;

    dispatchGatewayCronFinishedNotifications({
      evt: { jobId: job.id, action: "finished", status: "ok" },
      job,
      deps: {} as CliDeps,
      logger,
      resolveCronAgent: () => ({ agentId: "main", cfg: {} }),
    });

    expect(logger.warn).toHaveBeenCalledWith(
      {
        jobId: "cron-redact",
        deliveryTo: "ftp://example.invalid/hook",
      },
      "cron: skipped completion webhook delivery, delivery.completionDestination.to must be a valid http(s) URL",
    );
  });

  it.each([
    {
      runAtMs: Date.parse("2026-11-24T16:05:00.000Z"),
      suffix: "\nRun started: 2026-11-25 00:05 GMT+8",
    },
    { runAtMs: undefined, suffix: "" },
    { runAtMs: Number.NaN, suffix: "" },
    { runAtMs: Number.MAX_SAFE_INTEGER, suffix: "" },
  ])("formats the explicit failure destination start time ($runAtMs)", ({ runAtMs, suffix }) => {
    const logger = {
      warn: vi.fn(),
    };
    const job = {
      id: "cron-threaded-failure-dest",
      name: "threaded failure dest",
      enabled: true,
      createdAtMs: 1,
      updatedAtMs: 1,
      schedule: { kind: "every", everyMs: 60_000 },
      sessionTarget: "isolated",
      sessionKey: "agent:main:telegram:group:-1001234567890:thread:42",
      wakeMode: "next-heartbeat",
      payload: { kind: "agentTurn", message: "hello" },
      delivery: {
        mode: "announce",
        channel: "telegram",
        to: "-1001234567890",
        threadId: 42,
        failureDestination: {
          mode: "announce",
          channel: "telegram",
          to: "-1001234567890",
        },
      },
      state: {},
    } satisfies CronJob;

    dispatchGatewayCronFinishedNotifications({
      evt: {
        jobId: job.id,
        action: "finished",
        status: "error",
        error: "boom",
        runAtMs,
      },
      job,
      deps: {} as CliDeps,
      logger,
      resolveCronAgent: () => ({
        agentId: "main",
        cfg: { agents: { defaults: { userTimezone: "Asia/Shanghai" } } },
      }),
    });

    expect(mocks.sendFailureNotificationAnnounce).toHaveBeenCalledTimes(1);
    expect(mocks.sendFailureNotificationAnnounce.mock.calls[0]?.[4]).toEqual({
      channel: "telegram",
      to: "-1001234567890",
      accountId: undefined,
      sessionKey: "agent:main:telegram:group:-1001234567890:thread:42",
      inheritSessionThread: false,
    });
    expect(mocks.sendFailureNotificationAnnounce.mock.calls[0]?.[5]).toBe(
      `⚠️ Cron job "threaded failure dest" failed: boom${suffix}`,
    );
  });

  it("redacts command action-required summaries before webhook completion delivery", async () => {
    const logger = { warn: vi.fn() };
    const sensitiveSummary =
      "action-required output preserved:\nVisit www.example.com/device and enter code 123456\nLog in with token=opaque-secret-value";
    const job = {
      id: "cron-command-webhook-redact",
      name: "command webhook redact",
      enabled: true,
      createdAtMs: 1,
      updatedAtMs: 1,
      schedule: { kind: "every", everyMs: 60_000 },
      sessionTarget: "isolated",
      wakeMode: "next-heartbeat",
      payload: { kind: "command", argv: ["echo", "ok"] },
      delivery: {
        mode: "webhook",
        to: "https://example.invalid/cron",
      },
      state: {
        lastDiagnosticSummary: sensitiveSummary,
        lastDiagnostics: {
          summary: sensitiveSummary,
          entries: [
            {
              ts: 1,
              source: "exec",
              severity: "warn",
              message: sensitiveSummary,
            },
          ],
        },
      },
    } satisfies CronJob;

    dispatchGatewayCronFinishedNotifications({
      evt: {
        jobId: job.id,
        action: "finished",
        status: "ok",
        summary: sensitiveSummary,
        diagnostics: {
          summary: sensitiveSummary,
          entries: [
            {
              ts: 1,
              source: "exec",
              severity: "warn",
              message:
                "argv: node -e Visit www.example.com/device and enter code 123456; Log in with token=opaque-secret-value",
            },
          ],
        },
        job,
      },
      job,
      deps: {} as CliDeps,
      logger,
      resolveCronAgent: () => ({ agentId: "main", cfg: {} }),
    });

    await vi.waitFor(() => expect(mocks.fetchWithSsrFGuard).toHaveBeenCalledTimes(1));
    const body = webhookRequestBody();
    expect(body.summary).toContain("[redacted-url]");
    expect(body.summary).toContain("[redacted-code]");
    expect(body.summary).toContain("token=***");
    expect(body.summary).not.toContain("www.example.com/device");
    expect(body.summary).not.toContain("123456");
    expect(body.summary).not.toContain("opaque-secret-value");
    expect(body.diagnostics.summary).toBe(body.summary);
    expect(body.diagnostics.entries[0].message).toContain("[redacted-url]");
    expect(body.diagnostics.entries[0].message).toContain("[redacted-code]");
    expect(body.diagnostics.entries[0].message).toContain("token=***");
    expect(body.diagnostics.entries[0].message).not.toContain("www.example.com/device");
    expect(body.diagnostics.entries[0].message).not.toContain("123456");
    expect(body.diagnostics.entries[0].message).not.toContain("opaque-secret-value");
    expect(body.job.state).not.toHaveProperty("lastDiagnosticSummary");
    expect(body.job.state).not.toHaveProperty("lastDiagnostics");
  });

  it("omits failed command summaries and diagnostics from completion webhook delivery", async () => {
    const logger = { warn: vi.fn() };
    const sensitiveSummary =
      "action-required output preserved:\nVisit www.example.com/device and enter code 123456\nLog in with token=opaque-secret-value";
    const job = {
      id: "cron-command-webhook-failed-redact",
      name: "command webhook failed redact",
      enabled: true,
      createdAtMs: 1,
      updatedAtMs: 1,
      schedule: { kind: "every", everyMs: 60_000 },
      sessionTarget: "isolated",
      wakeMode: "next-heartbeat",
      payload: { kind: "command", argv: ["node", "-e", "process.exit(7)"] },
      delivery: {
        mode: "announce",
        completionDestination: {
          mode: "webhook",
          to: "https://example.invalid/cron",
        },
      },
      state: {
        lastDiagnosticSummary: sensitiveSummary,
        lastDiagnostics: {
          summary: sensitiveSummary,
          entries: [
            {
              ts: 1,
              source: "exec",
              severity: "error",
              message: sensitiveSummary,
            },
          ],
        },
      },
    } satisfies CronJob;

    dispatchGatewayCronFinishedNotifications({
      evt: {
        jobId: job.id,
        action: "finished",
        status: "error",
        error: "command exited with code 7",
        summary: sensitiveSummary,
        diagnostics: {
          summary: sensitiveSummary,
          entries: [
            {
              ts: 1,
              source: "exec",
              severity: "error",
              message: sensitiveSummary,
            },
          ],
        },
        job,
      },
      job,
      deps: {} as CliDeps,
      logger,
      resolveCronAgent: () => ({ agentId: "main", cfg: {} }),
    });

    await vi.waitFor(() => expect(mocks.fetchWithSsrFGuard).toHaveBeenCalledTimes(1));
    const body = webhookRequestBody();
    expect(body).toMatchObject({
      action: "finished",
      jobId: job.id,
      status: "error",
      error: "command exited with code 7",
    });
    expect(body).not.toHaveProperty("summary");
    expect(body).not.toHaveProperty("diagnostics");
    expect(body.job.state).not.toHaveProperty("lastDiagnosticSummary");
    expect(body.job.state).not.toHaveProperty("lastDiagnostics");
    expect(JSON.stringify(body)).not.toContain("www.example.com/device");
    expect(JSON.stringify(body)).not.toContain("123456");
    expect(JSON.stringify(body)).not.toContain("opaque-secret-value");
  });
});

describe("sendGatewayCronFailureAlert", () => {
  const runAtMs = Date.parse("2026-07-15T15:30:00.000Z");
  const job = {
    id: "failed-run",
    name: "Failed run",
    enabled: true,
    createdAtMs: runAtMs,
    updatedAtMs: runAtMs,
    schedule: { kind: "every", everyMs: 60_000 },
    sessionTarget: "isolated",
    wakeMode: "next-heartbeat",
    payload: { kind: "agentTurn", message: "report" },
    state: {},
  } satisfies CronJob;
  const params = {
    deps: {} as CliDeps,
    logger: { warn: vi.fn() },
    resolveCronAgent: () => ({
      agentId: "main",
      cfg: { agents: { defaults: { userTimezone: "America/New_York" } } },
    }),
    job,
    text: "cron failed",
    runAtMs,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("appends the start in the agent timezone to an immediate chat alert", async () => {
    await sendGatewayCronFailureAlert({
      ...params,
      mode: "announce",
      channel: "telegram",
      to: "123",
      accountId: "ops",
    });
    expect(mocks.sendCronAnnouncePayloadStrict).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "cron failed\nRun started: 2026-07-15 11:30 EDT",
        target: expect.objectContaining({ channel: "telegram", to: "123", accountId: "ops" }),
      }),
    );
  });

  it("sends the immediate webhook start as structured data", async () => {
    await sendGatewayCronFailureAlert({
      ...params,
      mode: "webhook",
      channel: "last",
      to: "https://example.invalid/cron",
    });
    expect(webhookRequestBody()).toEqual({
      jobId: job.id,
      jobName: job.name,
      message: "cron failed",
      runAtMs,
    });
  });
});
