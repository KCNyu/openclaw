// Fork delivery policy for transient tool failures in WeChat conversations.
const ALERT_AFTER = 3;
const STREAK_WINDOW_MS = 10 * 60_000;
const MAX_TRACKED_SESSIONS = 1024;

export type WeixinToolFailureNotice = "quiet" | { consecutiveFailures: number };

const streaks = new Map<string, { count: number; updatedAt: number; alertRunId?: string }>();

export function recordWeixinToolResult(params: {
  session: string;
  runId: string;
  failed: boolean;
}): WeixinToolFailureNotice | undefined {
  const { session, runId, failed } = params;
  const previous = streaks.get(session);
  streaks.delete(session);
  if (!failed) {
    return undefined;
  }

  const now = Date.now();
  const active = previous && now - previous.updatedAt < STREAK_WINDOW_MS ? previous : undefined;
  const count = (active?.count ?? 0) + 1;
  const alertRunId = active?.alertRunId ?? (count >= ALERT_AFTER ? runId : undefined);
  streaks.set(session, { count, updatedAt: now, alertRunId });
  if (streaks.size > MAX_TRACKED_SESSIONS) {
    const oldest = streaks.keys().next().value;
    if (oldest !== undefined) {
      streaks.delete(oldest);
    }
  }
  return alertRunId === runId ? { consecutiveFailures: count } : "quiet";
}
